// Shapes shared across files, as JSDoc types for npm run typecheck (TypeScript reads them; nothing runs here).
// Added 2026-11-20 after the outside reviews: the bugs they found were mostly one file reading a field under a name
// another file never wrote (a channel read job.data.locate.set; the field is set_name). A field listed here is
// checked in every file that starts with // @ts-check; job.data's other fields stay free-form for now.
// To use: /** @typedef {import("./types.js").Job} Job */ (path relative to the file).

/**
 * What a channel "locate" step read from the footage (channels/a channel.js, its AI schema).
 * @typedef {object} Locate
 * @property {"raw" | "multi" | "edited" | "other"} [kind]
 * @property {string} [set_name] the full official set name, as printed on the wrapper
 * @property {string} [product] the booster type
 * @property {"high" | "medium" | "low"} [product_confidence]
 * @property {number} [pack_front_time]
 * @property {number[]} [card_times]
 * @property {{ start: number, end: number, set_name: string, product: string }[]} [packs]
 * @property {"none" | "180" | "clockwise_90" | "counterclockwise_90"} [turn]
 * @property {boolean} [upside_down] older answers
 * @property {number} [subject_x]
 * @property {string} [notes]
 */

/**
 * The words written for the upload (title, description, pinned comment).
 * @typedef {object} MetaOut
 * @property {string} [title]
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {string} [pinned_comment]
 * @property {string} [tiktok_caption]
 */

/**
 * @typedef {{ locate?: Locate, meta_out?: MetaOut, [key: string]: any }} JobData
 */

/**
 * One pipeline job (data/jobs/<id>/job.json), as jobs.js createJob makes it.
 * @typedef {object} Job
 * @property {string} id channel, UTC stamp, 4 random characters (JOB_ID)
 * @property {string} channel
 * @property {string} sourceName
 * @property {string} status queued, running, held, failed, skipped, tested, private, scheduled, published, publishing, split
 * @property {string | null} stage
 * @property {string} createdAt
 * @property {string | null} updatedAt
 * @property {any} hold
 * @property {string[]} flags
 * @property {JobData} data
 * @property {{ at: string, message: string }[]} log
 * @property {any} [error]
 */

export {};
