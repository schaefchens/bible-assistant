/**
 * Integration-layer environment. jsdom gives us a DOM and localStorage; it has
 * no IndexedDB, and Dexie needs one the moment anything is queried (it
 * constructs fine without — `MissingAPIError` is thrown at `.open()`, not at
 * `new`, which is why importing a store works in plain node but using one does
 * not).
 */
import 'fake-indexeddb/auto';
