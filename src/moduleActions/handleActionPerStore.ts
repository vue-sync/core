import { O } from 'ts-toolbelt'
import { handleAction } from './handleAction'
import { getEventNameFnsMap } from '../types/events'
import {
  ActionType,
  ActionConfig,
  ActionName,
  ActionTernary,
  VueSyncGetAction,
  VueSyncWriteAction,
  VueSyncDeleteAction,
  VueSyncDeletePropAction,
  VueSyncInsertAction,
} from '../types/actions'
import {
  PluginModuleConfig,
  GetResponse,
  isDoOnGet,
  isGetResponse,
  DoOnGet,
} from '../types/plugins'
import { getModifyPayloadFnsMap } from '../types/modifyPayload'
import { OnAddedFn, getModifyReadResponseFnsMap } from '../types/modifyReadResponse'
import { executeOnFns } from '../helpers/executeOnFns'
import { throwIfNoFnsToExecute } from '../helpers/throwFns'
import { ModuleConfig, GlobalConfig } from '../types/base'
import { isFullString, isPlainObject, isFunction } from 'is-what'
import { CollectionInstance } from '../Collection'
import { DocInstance } from '../Doc'
import { getCollectionPathDocIdEntry } from '../helpers/pathHelpers'
import { CollectionFn, DocFn } from '..'

export function handleActionPerStore<TActionName extends Exclude<ActionName, 'stream'>> (
  modulePath: string,
  moduleConfig: ModuleConfig,
  globalConfig: O.Compulsory<GlobalConfig>,
  actionName: TActionName,
  actionType: ActionType,
  doc: DocFn, // actions executed on a "doc" will always return `doc()`
  collection?: CollectionFn // actions executed on a "collection" will return `collection()` or `doc()`
): ActionTernary<TActionName>

export function handleActionPerStore (
  modulePath: string,
  moduleConfig: ModuleConfig,
  globalConfig: O.Compulsory<GlobalConfig>,
  actionName: Exclude<ActionName, 'stream'>,
  actionType: ActionType,
  doc: DocFn, // actions executed on a "doc" will always return `doc()`
  collection?: CollectionFn // actions executed on a "collection" will return `collection()` or `doc()`
):
  | VueSyncGetAction
  | VueSyncWriteAction
  | VueSyncInsertAction
  | VueSyncDeleteAction
  | VueSyncDeletePropAction {
  // returns the action the dev can call with myModule.insert() etc.
  return async function (
    payload?: void | object | string | string[],
    actionConfig: ActionConfig = {}
  ): Promise<DocInstance | CollectionInstance> {
    // get all the config needed to perform this action
    const onError = actionConfig.onError || moduleConfig.onError || globalConfig.onError
    const modifyPayloadFnsMap = getModifyPayloadFnsMap(
      globalConfig.modifyPayloadOn,
      moduleConfig.modifyPayloadOn,
      actionConfig.modifyPayloadOn
    )
    const modifyReadResponseMap = getModifyReadResponseFnsMap(
      globalConfig.modifyReadResponseOn,
      moduleConfig.modifyReadResponseOn,
      actionConfig.modifyReadResponseOn
    )
    const eventNameFnsMap = getEventNameFnsMap(globalConfig.on, moduleConfig.on, actionConfig.on)
    const storesToExecute: string[] =
      actionConfig.executionOrder ||
      (moduleConfig.executionOrder || {})[actionName] ||
      (moduleConfig.executionOrder || {})[actionType] ||
      (globalConfig.executionOrder || {})[actionName] ||
      (globalConfig.executionOrder || {})[actionType] ||
      []
    throwIfNoFnsToExecute(storesToExecute)
    // update the payload
    for (const modifyFn of modifyPayloadFnsMap[actionName]) {
      payload = modifyFn(payload as any)
    }

    // create the abort mechanism
    type StopExecution = boolean | 'revert'
    let stopExecution = false as StopExecution
    /**
     * The abort mechanism for the entire store chain. When executed in handleAction() it won't go to the next store in executionOrder.
     */
    function stopExecutionAfterAction (trueOrRevert: StopExecution = true): void {
      stopExecution = trueOrRevert
    }

    // each each time a store returns a `GetResponse` then all `doOnGetFns` need to be executed
    const doOnGetFns: DoOnGet[] = modifyReadResponseMap.added

    const [collectionPath, docId] = getCollectionPathDocIdEntry(modulePath)
    // check if this action was executed from a "collection" or a "doc"
    const isDocModule = !!docId
    const isCollectionModule = !isDocModule

    // handle and await each action in sequence
    let resultFromPlugin: void | string | GetResponse | OnAddedFn
    for (const [i, storeName] of storesToExecute.entries()) {
      // a previous iteration stopped the execution:
      if (stopExecution === 'revert' || stopExecution === true) break
      // find the action on the plugin
      const pluginAction = globalConfig.stores[storeName].actions[actionName]
      const moduleConfigPerStore = moduleConfig?.configPerStore || {}
      const pluginModuleConfig: PluginModuleConfig = moduleConfigPerStore[storeName] || {}
      // the plugin action
      resultFromPlugin = !pluginAction
        ? resultFromPlugin
        : await handleAction({
            modulePath,
            pluginAction,
            pluginModuleConfig,
            payload, // should always use the payload as passed originally for clarity
            eventNameFnsMap,
            onError,
            actionName,
            stopExecutionAfterAction,
            storeName,
          })
      // handle reverting. stopExecution might have been modified by `handleAction`
      if ((stopExecution as any) === 'revert') {
        const storesToRevert = storesToExecute.slice(0, i)
        storesToRevert.reverse()
        for (const storeToRevert of storesToRevert) {
          const pluginRevertAction = globalConfig.stores[storeToRevert].revert
          await pluginRevertAction(payload, modulePath, pluginModuleConfig, actionName)
          // revert eventFns, handle and await each eventFn in sequence
          for (const fn of eventNameFnsMap.revert) {
            await fn({ payload, result: resultFromPlugin, actionName, storeName })
          }
        }
      }

      // special handling for 'insert' (resultFromPlugin will always be `string`)
      if (actionName === 'insert' && isFullString(resultFromPlugin)) {
        // update the modulePath if a doc with random ID was inserted in a collection
        // if this is the case the result will be a string - the randomly genererated ID
        if (isCollectionModule) {
          modulePath = `${modulePath}/${resultFromPlugin}`
        }
      }

      // special handling for 'get' (resultFromPlugin will always be `GetResponse | OnAddedFn`)
      if (actionName === 'get') {
        if (isDoOnGet(resultFromPlugin)) {
          doOnGetFns.push(resultFromPlugin)
        }
        if (isGetResponse(resultFromPlugin)) {
          for (const docRetrieved of resultFromPlugin.docs) {
            executeOnFns(doOnGetFns, docRetrieved.data, [docRetrieved])
          }
        }
      }
    }
    if (isDocModule) return doc(modulePath, moduleConfig)
    // it's originally triggered on a "collection":
    if (actionName === 'insert') {
      // insert always returns a DocInstance, and the ID is now available on the modulePath which was modified
      return doc(modulePath, moduleConfig)
    }
    // all other actions triggered on collections ('get' is the only possibility left)
    // should return the collection:
    return collection(modulePath, moduleConfig)
  }
}
