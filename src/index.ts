// tslint:disable:no-unnecessary-type-assertion
import { DecodedLogEvent, ExchangeEvents, LogFillContractEventArgs, ZeroEx } from '0x.js';
import { HttpClient } from '@0xproject/connect';
import { getOrderHashHex } from '@0xproject/order-utils';
import {
    OrderState,
    OrderStateInvalid,
    OrderStateValid,
    SignedOrder,
} from '@0xproject/types';
import { logUtils } from '@0xproject/utils';
import { Web3Wrapper } from '@0xproject/web3-wrapper';
import * as _ from 'lodash';
import Web3ProviderEngine = require('web3-provider-engine');
import RPCSubprovider = require('web3-provider-engine/subproviders/rpc');

import { OrderWatcher } from '../node_modules/@0xproject/order-watcher';

async function mainAsync() {
    let zeroEx: ZeroEx;
    let orderWatcher: OrderWatcher;
    const provider = new Web3ProviderEngine();
    const rpcSubprovider = new RPCSubprovider({
        rpcUrl: 'https://mainnet.infura.io/',
    });
    provider.addProvider(rpcSubprovider);
    provider.start();
    const web3Wrapper = new Web3Wrapper(provider);
    const networkId = await web3Wrapper.getNetworkIdAsync();
    const config = {
        networkId,
    };
    zeroEx = new ZeroEx(provider, config);
    orderWatcher = await zeroEx.createOrderWatcherAsync({
        isVerbose: true,
    });

    const seenOrders: { [orderHash: string]: boolean } = {};
    zeroEx.exchange.subscribe<LogFillContractEventArgs>(
        ExchangeEvents.LogFill,
        {},
        (err: null | Error, logEvent?: DecodedLogEvent<LogFillContractEventArgs>) => {
            if (!_.isNull(err)) {
                logUtils.warn('Log subscription error: ', err);
            }
            if (_.isUndefined(logEvent)) {
                throw new Error(`logEvent cannot be undefined if err is not null`);
            }
            if (!logEvent.isRemoved && seenOrders[logEvent.log.args.orderHash]) {
                logUtils.warn(`LogFill event found for: ${logEvent.log.args.orderHash}`);
            }
        },
    );

    orderWatcher.subscribe((err: Error | null, orderState: OrderState | undefined) => {
        if (err) {
            logUtils.warn(`OrderWatcher subscription callback recevied error: ${err.message}`);
            return;
        }
        if (_.isUndefined(orderState)) {
            throw new Error(`OrderState cannot be undefined if err is not null`);
        }
        if (!orderState.isValid) {
            const orderStateInvalid = orderState as OrderStateInvalid;
            orderWatcher.removeOrder(orderStateInvalid.orderHash);
            logUtils.warn(`Removed invalidated order ${orderStateInvalid.orderHash} - ${orderStateInvalid.error}`);
        } else {
            const orderStateValid = orderState as OrderStateValid;
            logUtils.warn(`Order state updated, but still valid: ${orderStateValid.orderHash}`);
        }
    });

    // Get orders from ERCDEX on interval and dump into OrderWatcher
    const intervalMs = 10000; // 10 sec
    const client = new HttpClient('https://api.ercdex.com/api/standard/1/v0');
    setInterval(() => {
        const numPagesToFetch = 5;
        _.times(numPagesToFetch, async (n: number) => {
            const orders = await client.getOrdersAsync({
                page: n + 1,
                perPage: 100,
            });
            _.each(orders, (order: SignedOrder) => {
                const orderHash = getOrderHashHex(order);
                if (_.isUndefined(seenOrders[orderHash])) {
                    orderWatcher.addOrder(order);
                    seenOrders[orderHash] = true;
                    console.log(`Added order to watcher: ${orderHash}`);
                }
            });
        });
    }, intervalMs);
}

mainAsync();
