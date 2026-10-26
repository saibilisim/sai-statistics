// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod'
import { handleValidated } from '../security'

// One DuckDB connection serves every dataset, and several handlers rebuild a
// table in several statements (CREATE temp → DROP → RENAME, ALTER → UPDATE).
// Interleaved at the await points, two of them corrupt each other (a sort
// racing a delete leaves the dataset table missing). DB-touching IPC handlers
// therefore run strictly one after another.
let tail: Promise<unknown> = Promise.resolve()

function runExclusive<R>(work: () => R | Promise<R>): Promise<R> {
  const run = tail.then(work, work)
  tail = run.catch(() => undefined)
  return run
}

/** `handleValidated`, but the handler body waits for every earlier DB handler to finish. */
export function handleSerialized<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  handler: (payload: z.infer<S>, event: Electron.IpcMainInvokeEvent) => R | Promise<R>
): void {
  handleValidated(channel, schema, (payload, event) => runExclusive(() => handler(payload, event)))
}
