#!/usr/bin/env node

const pull = require('pull-stream')
const ssbClient = require('ssb-client')
const _ = require('deepdash')(require('lodash'))
const ref = require('ssb-ref')
const multiblob = require('multiblob')
const path = require('path')
const debug = require('debug')('ssb-blob-prune')
const os = require('os')

debug.enabled = true

const config = {
  messagesPerDebug: 1000
}

// create a scuttlebot client using default settings
// (server at localhost:8080, using key found at ~/.ssb/secret)
ssbClient(function (err, sbot) {
  if (err) {
    debug('could not connect to sbot, please ensure that it\'s running')
    throw err
  }

  debug('connected to sbot')

  const mentionedBlobs = []
  const strayBlobs = []
  let messagesConsumed = 0

  const debugMessages = debug.extend('messages')

  // stream all messages in all feeds, ordered by publish time
  pull(
    sbot.createFeedStream({ private: true }),
    pull.drain((msg) => {
      // on each
      messagesConsumed = messagesConsumed + 1
      if (messagesConsumed % config.messagesPerDebug === 0) {
        debugMessages('%d', messagesConsumed)
      }

      _.eachDeep(msg, value => {
        if (ref.isBlob(value)) {
          const sansAmpersand = value.substr(1)
          mentionedBlobs.push(sansAmpersand)
        }
      })
    }, () => {
      const debugBlobs = debug.extend('blobs')
      debugBlobs('enumerating')
      // on done
      var blobs = multiblob({
        dir: path.join(os.homedir(), '.ssb', 'blobs'),
        alg: 'sha256'
      })

      pull(
        blobs.ls(),
        pull.drain((blob) => {
          if (!mentionedBlobs.includes(blob)) {
            debugBlobs('stray %s', blob)
            strayBlobs.push(blob)
            blobs.rm(blob, (err, val) => {
              if (err) throw err

              if (val) debugBlobs('%s', val)
            })
          }
        }, () => {
          debug('previous total: %d', mentionedBlobs.length)
          debug('deleted: %d', strayBlobs.length)
          const currentTotal = mentionedBlobs.length - strayBlobs.length
          debug('current total: %d', currentTotal)
          sbot.close()
        })
      )
    })
  )
})
