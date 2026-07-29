/**
 * Generic React error boundary — catches render crashes so a child tree
 * cannot blank the whole app (mobile White Screen of Death).
 */
import React from 'react';

export type ErrorBoundaryFallbackProps = {
  error: Error | null;
  reset: () => void;
};

type Props = {
  children: React.ReactNode;
  /** Static node or render-prop for the recovery UI. */
  fallback:
    | React.ReactNode
    | ((props: ErrorBoundaryFallbackProps) => React.ReactNode);
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /**
   * When any value changes, clear the error state so a remounted child
   * (e.g. feed reopened) can recover without a full page reload.
   */
  resetKeys?: readonly unknown[];
};

type State = {
  hasError: boolean;
  error: Error | null;
};

function resetKeysChanged(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined
): boolean {
  if (prev === next) return false;
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  return prev.some((v, i) => !Object.is(v, next[i]));
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') {
        return fallback({ error: this.state.error, reset: this.reset });
      }
      return fallback;
    }
    return this.props.children;
  }
}
