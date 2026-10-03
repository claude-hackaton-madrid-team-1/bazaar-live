import type { MotionProps } from 'motion/react'

type Appear = Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'>

/**
 * Entrance and exit props for something that comes and goes on the stage. With Reduce Motion it
 * appears and leaves without animating (MotionConfig's reducedMotion="user" stops transforms only,
 * not opacity); `still` is how it rests then, the end of `animate` by default.
 */
export function appear(reduce: boolean | null, props: Appear, still: MotionProps['animate'] = props.animate): Appear {
  return reduce ? { initial: false, animate: still, transition: { duration: 0 } } : props
}

/** The house ease (--ease-out): calm, no bounce. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
