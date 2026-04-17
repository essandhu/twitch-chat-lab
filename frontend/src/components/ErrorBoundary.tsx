import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '../lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logger.error('error_boundary_caught', {
      label: this.props.label,
      message: error.message,
      stack: error.stack,
    })
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    const { children, fallback, label } = this.props

    if (error === null) return children
    if (fallback) return fallback(error, this.reset)

    return (
      <div className="border border-ink-700 bg-ink-900/60 p-4 text-sm font-mono">
        <p className="text-ink-300">
          {label ?? 'This section'} hit an error. Reload to recover.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="text-xs uppercase tracking-[0.2em] text-ember-500 hover:text-ember-400 mt-2"
        >
          Retry
        </button>
      </div>
    )
  }
}
