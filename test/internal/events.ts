import test from 'ava'
import { createVueSyncInstance } from '../helpers/createVueSyncInstance'
import { pokedex } from '../helpers/pokedex'

test('delete: emits before & success events', async t => {
  const { pokedexModule } = createVueSyncInstance()
  const insertPayload = pokedex(7)
  await pokedexModule.insert(insertPayload)
  let ranAllEvents = []
  await pokedexModule.doc('7').delete(undefined, {
    on: {
      before: ({ payload, storeName }) => {
        ranAllEvents.push(1)
      },
      success: ({ payload, storeName }) => {
        ranAllEvents.push(1)
      },
    },
  })
  t.is(ranAllEvents.length, 4)
})

test('insert: emits before & success events', async t => {
  const { pokedexModule } = createVueSyncInstance()
  const insertPayload = pokedex(7)
  let ranAllEvents = []
  await pokedexModule.insert(insertPayload, {
    on: {
      before: ({ payload, storeName }) => {
        if (storeName === 'local') {
          t.deepEqual(payload, insertPayload)
          ranAllEvents.push(1)
        }
        if (storeName === 'remote') {
          t.deepEqual(payload, insertPayload)
          ranAllEvents.push(1)
        }
      },
      success: ({ payload, storeName }) => {
        if (storeName === 'local') {
          t.deepEqual(payload, insertPayload)
          ranAllEvents.push(1)
        }
        if (storeName === 'remote') {
          t.deepEqual(payload, insertPayload)
          ranAllEvents.push(1)
        }
      },
    },
  })
  t.is(ranAllEvents.length, 4)
})

test('insert: can abort in before events', async t => {
  const { pokedexModule } = createVueSyncInstance()
  const insertPayload = pokedex(7)
  try {
    const result = await pokedexModule.insert(insertPayload, {
      on: {
        before: ({ payload, abort, storeName }) => {
          if (storeName === 'local') {
            abort()
          }
          if (storeName === 'remote') t.fail()
        },
        success: ({ storeName, result }) => t.fail(),
        error: ({ storeName }) => {
          if (storeName === 'local') t.fail()
        },
      },
    })
    t.is(result.id, pokedexModule.id)
  } catch (error) {
    t.fail(error)
  }
})

test('insert: can abort in success events', async t => {
  const { pokedexModule } = createVueSyncInstance()
  const insertPayload = pokedex(7)
  let ranAllEvents = []
  try {
    const result = await pokedexModule.insert(insertPayload, {
      on: {
        before: ({ payload, storeName }) => {
          if (storeName === 'local') {
            ranAllEvents.push(1)
          }
          if (storeName === 'remote') t.fail()
        },
        success: ({ payload, abort, storeName }) => {
          if (storeName === 'local') {
            ranAllEvents.push(1)
            abort()
          }
        },
      },
    })
    t.deepEqual(result.data, insertPayload)
  } catch (error) {
    t.fail(error)
  }
  t.is(ranAllEvents.length, 2)
})
