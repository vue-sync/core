import { O } from 'ts-toolbelt'
import { VueSyncConfig } from '..'
import { ModuleConfig } from '../CreateModule'
import { getEventFnsPerStore } from '../getEventFnsPerStore'
import { handleStream } from './handleStream'
import { EventFnsPerStore, eventFnsMapWithDefaults } from '../types/events'
import { ActionType, ActionConfig, VueSyncStreamAction } from '../types/actions'
import { PluginModuleConfig, OnNextStoresStream } from '../types/plugins'

export function handleStreamPerStore (
  moduleConfig: ModuleConfig,
  globalConfig: O.Compulsory<VueSyncConfig>,
  actionType: ActionType,
  openStreams: { [identifier: string]: () => void }
): VueSyncStreamAction {
  // returns the action the dev can call with myModule.insert() etc.
  return async function<T extends object> (
    payload: T,
    actionConfig: ActionConfig = {}
  ): Promise<void> {
    // get all the config needed to perform this action
    const eventFnsPerStore: EventFnsPerStore = getEventFnsPerStore(
      globalConfig,
      moduleConfig,
      actionConfig
    )
    const storesToExecute: string[] =
      actionConfig.executionOrder ||
      (moduleConfig.executionOrder || {})['stream'] ||
      (moduleConfig.executionOrder || {})[actionType] ||
      (globalConfig.executionOrder || {})['stream'] ||
      (globalConfig.executionOrder || {})[actionType] ||
      []
    if (storesToExecute.length === 0) {
      throw new Error('None of your store plugins have implemented this function.')
    }

    // a mutatable array of successevents which is to be triggered each time a next store triggers a successevent
    const onNextStoresStream: OnNextStoresStream = {
      inserted: [],
      merged: [],
      assigned: [],
      replaced: [],
      deleted: [],
    }

    const streamInfoPerStore: {
      [storeName: string]: { streaming: Promise<void>; stop: () => void }
    } = {}

    // handle and await each action in sequence
    for (const storeName of storesToExecute) {
      // find the action on the plugin
      const pluginAction = globalConfig.stores[storeName].actions['stream']
      const pluginModuleConfig: PluginModuleConfig = moduleConfig?.configPerStore[storeName] || {}
      const eventNameFnsMap = eventFnsMapWithDefaults(eventFnsPerStore[storeName])
      // the plugin action
      if (pluginAction) {
        const streamInfo = await handleStream({
          pluginAction,
          pluginModuleConfig,
          payload, // should always use the payload as passed originally for clarity
          eventNameFnsMap,
          actionName: 'stream',
          onNextStoresStream,
        })
        if (streamInfo) streamInfoPerStore[storeName] = streamInfo
      }
    }
    const streamPromises = Object.entries(streamInfoPerStore).map(([storeName, streamInfo]) => {
      // return the streaming promises
      return streamInfo.streaming
    })
    // create a function to stop all streams
    const identifier = JSON.stringify(payload)
    openStreams[identifier] = (): void =>
      Object.values(streamInfoPerStore).forEach(({ stop }) => stop())
    // return all the stream promises as one promise
    return new Promise((resolve, reject) => {
      Promise.all(streamPromises)
        // todo: why can I not just write then(resolve)
        .then(() => resolve())
        .catch(reject)
    })
  }
}