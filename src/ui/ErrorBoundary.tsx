import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  readonly children: ReactNode
  readonly fallback: ReactNode
}

interface State {
  readonly failed: boolean
}

/** A drawing bug must not take the transcript (or the voices) down with it. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept for whoever opens the console during the pitch.
    console.error('Bazaar Live stage error', error, info.componentStack)
    setTimeout(() => this.setState({ failed: false }), 5000)
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
