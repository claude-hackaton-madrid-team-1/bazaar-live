/**
 * No voice ever reads an injection row: the page's panel (src/ui/InjectionsPanel.tsx, src/ui/injectionRows.ts) and the
 * show's voice pipeline (the director, the speech queue, the stage, the transcript feed) never import each other.
 * The TTS proxy's own guard is tested in server/app.test.ts; the show's quote guard in src/show/real.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'src')

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(dir, e.name)] : []))

describe('the injection panel and the voice pipeline stay apart', () => {
  it('no module of the show director, the speech queue, the stage or the transcript feed imports the panel or its data', () => {
    const voice = [...files(join(SRC, 'show')), ...files(join(SRC, 'tts')), ...files(join(SRC, 'stage')), join(SRC, 'ui', 'useShow.ts'), join(SRC, 'net', 'transcript.ts')]
    expect(voice.length).toBeGreaterThan(10)
    for (const f of voice) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"][^'"]*(InjectionsPanel|injectionRows)['"]/)
  })

  it('the panel imports nothing from the voice pipeline', () => {
    for (const f of ['injectionRows.ts', 'InjectionsPanel.tsx']) expect(readFileSync(join(SRC, 'ui', f), 'utf8')).not.toMatch(/from ['"][^'"]*(\/tts\/|\/show\/|useShow|speech|Voice)/)
  })

  it('the panel never renders raw HTML or markdown', () => {
    for (const f of ['injectionRows.ts', 'InjectionsPanel.tsx']) expect(readFileSync(join(SRC, 'ui', f), 'utf8')).not.toMatch(/dangerouslySetInnerHTML\s*=|\.innerHTML\b|\.outerHTML\b|from ['"][^'"]*mark(ed|down)/)
  })
})
