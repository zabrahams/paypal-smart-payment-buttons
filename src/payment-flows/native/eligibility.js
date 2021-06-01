/* @flow */

import type { ZalgoPromise } from 'zalgo-promise/src';
import { PLATFORM, ENV, FUNDING } from '@paypal/sdk-constants/src';
import { supportsPopups, isIos, isAndroid } from 'belter/src';

import { type NativeEligibility, getNativeEligibility } from '../../api';
import { isIOSSafari, isAndroidChrome, enableAmplitude, briceLog } from '../../lib';
import { LSAT_UPGRADE_EXCLUDED_MERCHANTS } from '../../constants';
import type { FundingType } from '../../types';
import type { ButtonProps, ServiceData } from '../../button/props';
import type { IsEligibleOptions, IsPaymentEligibleOptions } from '../types';

import { NATIVE_CHECKOUT_URI, NATIVE_CHECKOUT_POPUP_URI, NATIVE_CHECKOUT_FALLBACK_URI, SUPPORTED_FUNDING } from './config';

export function isTestGroup(nativeEligibility : NativeEligibility, fundingSource : $Values<typeof FUNDING>) : boolean {
    const fundingEligibility = nativeEligibility[fundingSource];

    if (fundingEligibility && fundingEligibility.eligibility) {
        return true;
    }

    return false;
}

export function isControlGroup(nativeEligibility : NativeEligibility, fundingSource : $Values<typeof FUNDING>) : boolean {
    const fundingEligibility = nativeEligibility[fundingSource];

    if (fundingEligibility && !fundingEligibility.eligibility && fundingEligibility.ineligibilityReason === 'experimentation_ineligibility') {
        return true;
    }

    return false;
}

export function isAnyTestOrControlGroup({ nativeEligibility } : {| nativeEligibility : NativeEligibility |}) : boolean {
    for (const fundingSource of SUPPORTED_FUNDING) {
        if (isTestGroup(nativeEligibility, fundingSource) || isControlGroup(nativeEligibility, fundingSource)) {
            return true;
        }
    }

    return false;
}

export function isNativeOptedIn({ props } : {| props : ButtonProps |}) : boolean {
    briceLog('payment-flows/native/eligibility.js/isNativeOptedIn');

    const { enableNativeCheckout } = props;

    if (enableNativeCheckout) {
        return true;
    }

    try {
        if (window.localStorage.getItem('__native_checkout__')) {
            return true;
        }
    } catch (err) {
        // pass
    }

    return false;
}

type PrefetchNativeEligibilityOptions = {|
    props : ButtonProps,
    serviceData : ServiceData
|};

export function prefetchNativeEligibility({ props, serviceData } : PrefetchNativeEligibilityOptions) : ZalgoPromise<void> {
    const { clientID, onShippingChange, currency, platform, env,
        vault, buttonSessionID, enableFunding, merchantDomain } = props;
    const { merchantID, buyerCountry, cookies } = serviceData;
    const shippingCallbackEnabled = Boolean(onShippingChange);

    return getNativeEligibility({
        vault, platform, shippingCallbackEnabled, clientID, buyerCountry, currency, buttonSessionID, cookies, enableFunding,
        stickinessID: null,
        skipElmo:     true,
        merchantID:   merchantID[0],
        domain:       merchantDomain
    }).then(nativeEligibility => {
        if (isAnyTestOrControlGroup({ nativeEligibility })) {
            enableAmplitude({ env });
        }
    });
}

export function canUseVenmoDesktopPay(funding : ?FundingType) : boolean {
    return (!funding) ? false :
        (funding === FUNDING.VENMO)  &&
        !isIos() &&
        !isAndroid();
}

export function isNativeEligible({ props, config, serviceData } : IsEligibleOptions) : boolean {
    const { clientID, platform, fundingSource, onShippingChange, createBillingAgreement, createSubscription, env, enableFunding } = props;
    const { firebase: firebaseConfig } = config;
    const { merchantID } = serviceData;
    const funding = fundingSource || enableFunding[0];
    const isValidVenmoDesktopPaySituation = canUseVenmoDesktopPay(funding);

    if (platform !== PLATFORM.MOBILE &&
        !isIOSSafari() &&
        !isAndroidChrome() &&
        !isValidVenmoDesktopPaySituation
    ) {
        return false;
    }
    
    if (onShippingChange &&
        (!isNativeOptedIn({ props }) && !isValidVenmoDesktopPaySituation)
    ) {
        return false;
    }

    if (createBillingAgreement || createSubscription) {
        return false;
    }

    if (!supportsPopups()) {
        return false;
    }

    if (!firebaseConfig) {
        return false;
    }

    if (isNativeOptedIn({ props })) {
        return true;
    }

    if (!isValidVenmoDesktopPaySituation &&
        (env === ENV.LOCAL || env === ENV.STAGE)
    ) {
        return false;
    }

    if (merchantID.length > 1) {
        return false;
    }

    if (LSAT_UPGRADE_EXCLUDED_MERCHANTS.indexOf(clientID) !== -1) {
        return false;
    }

    return true;
}

export function isNativePaymentEligible({ payment } : IsPaymentEligibleOptions) : boolean {
    briceLog('payment-flows/native/eligibility.js/isNativePaymentEligible');

    const { win, fundingSource } = payment;

    if (win) {
        return false;
    }

    if (!NATIVE_CHECKOUT_URI[fundingSource] || !NATIVE_CHECKOUT_POPUP_URI[fundingSource] || !NATIVE_CHECKOUT_FALLBACK_URI[fundingSource]) {
        return false;
    }

    return true;
}