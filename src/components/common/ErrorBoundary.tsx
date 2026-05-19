import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-4 text-cream font-mono text-sm space-y-3">
        <div className="text-red-400 font-bold">Something crashed</div>
        <div className="bg-navy-deep p-3 rounded text-xs whitespace-pre-wrap break-all">
          {error.message}
        </div>
        {error.stack && (
          <details className="text-xs">
            <summary className="cursor-pointer text-cream-dim">stack</summary>
            <pre className="bg-navy-deep p-3 rounded mt-1 whitespace-pre-wrap break-all">
              {error.stack}
            </pre>
          </details>
        )}
        <button onClick={this.reset} className="btn-primary text-xs">
          Try again
        </button>
      </div>
    );
  }
}
