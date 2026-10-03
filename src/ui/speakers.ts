/** The name a caption shows for whoever speaks a line: a character, a known dealer, or a guest dealer by its game name. */
import type { Speaker } from '../../shared/tags.ts'
import type { DealerNames } from '../net/dealers'
import type { Strings } from './strings'

const title = (id: string): string => id.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase())

export function speakerName(t: Strings, speaker: Speaker, dealer: string | undefined, names: DealerNames): string {
  switch (speaker) {
    case 'buyer':
      return t.buyer
    case 'seller':
      return t.seller
    case 'abuela':
    case 'chato':
    case 'pilar':
      return t.dealers[speaker]
    case 'guest1':
    case 'guest2':
    case 'guest3':
      return (dealer && (names[dealer] ?? title(dealer))) || t.dealers.other
    case 'narrator':
      return t.narrator
  }
}
