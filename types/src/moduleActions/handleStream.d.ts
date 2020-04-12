import { PlainObject } from '../types/base';
import { EventNameFnsMap } from '../types/events';
import { PluginModuleConfig, PluginStreamAction, DoOnStream, StreamResponse } from '../types/plugins';
import { O } from 'ts-toolbelt';
/**
 * handleStream is responsible for executing (1) on.before (2) the action provided by the store plugin (3) on.error / on.success
 */
export declare function handleStream(args: {
    modulePath: string;
    pluginAction: PluginStreamAction;
    pluginModuleConfig: PluginModuleConfig;
    payload: PlainObject | void;
    eventNameFnsMap: EventNameFnsMap;
    actionName: 'stream';
    storeName: string;
    mustExecuteOnRead: O.Compulsory<DoOnStream>;
}): Promise<StreamResponse | DoOnStream>;
