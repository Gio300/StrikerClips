/**
 * Generate a VAPID keypair for phone push notifications, and print it.
 *
 *   npx tsx scripts/generate-vapid-keys.ts
 *
 * WHAT THIS IS. VAPID is how a push service (FCM for Android Chrome, Apple's for
 * iOS PWAs, Mozilla's for Firefox) knows a push request came from THIS
 * application server. The keypair is generated once, for the deployment, and
 * then never changes: the PUBLIC key is baked into every subscription the
 * browser creates, so rotating it invalidates every subscription in the database
 * and every member has to opt in again.
 *
 * WHAT THIS SCRIPT WILL NOT DO. It does not write a file, it does not touch
 * .env, and nothing in this repo commits keys. It prints; the operator places
 * them. The private key is a credential — treat it like the Stripe secret.
 *
 * WITH NO KEYS SET, the whole feature is inert by design: /api/fn/push-config
 * answers `enabled: false`, the opt-in control never renders, nothing
 * subscribes, and every send path returns before it reads the database. Setting
 * these two variables (and restarting the API — Node does not hot-reload) is the
 * single switch that turns it on.
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

const line = '─'.repeat(72)
console.log(line)
console.log('VAPID keypair for TKO phone notifications')
console.log(line)
console.log('')
console.log('Set these on the API service (Cloud Run service "killcam") and on')
console.log('any worker that sends notifications, then RESTART it:')
console.log('')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('VAPID_SUBJECT=mailto:you@tko.cam')
console.log('')
console.log('Notes:')
console.log('  • VAPID_SUBJECT must be a mailto: address or an https URL — it is')
console.log('    who a push service contacts about this application server. It')
console.log('    defaults to https://tko.cam if unset, but set a real one.')
console.log('  • Keep VAPID_PRIVATE_KEY secret. Do not commit it.')
console.log('  • Do NOT regenerate these once members have subscribed: the public')
console.log('    key is embedded in every existing subscription, and changing it')
console.log('    silently breaks all of them.')
console.log('  • Until both keys are set, the feature stays completely off — the')
console.log('    opt-in control does not even render.')
console.log('')
console.log(line)
