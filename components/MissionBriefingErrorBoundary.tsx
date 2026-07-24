import React from 'react';

type Props = {
  children: React.ReactNode;
  onError?: (error: Error) => void;
};

type State = { hasError: boolean };

/**
 * Prevents a single mission sheet crash from blanking the entire map (WSOD).
 */
export default class MissionBriefingErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[MissionBriefing] render crash:', error);
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
