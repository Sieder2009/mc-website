import { Component } from "react";

// WebGL can fail for all sorts of reasons outside our control (blocked
// drivers, exhausted contexts, browser flags). If the 3D scene throws,
// this swallows it quietly and falls back to whatever renders behind it
// (the kanji watermark) instead of taking the whole page down.
export default class CanvasBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("3D scene disabled:", error);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
