import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "30px", background: "#1e1f22", color: "#f23f43", minHeight: "100vh", fontFamily: "monospace", overflow: "auto" }}>
          <h1 style={{ fontSize: "20px", marginBottom: "10px" }}>⚠️ Runtime Error Detected:</h1>
          <p style={{ color: "#ffffff", marginBottom: "15px", fontSize: "16px" }}>{this.state.error?.message}</p>
          <pre style={{ background: "#2b2d31", padding: "15px", borderRadius: "6px", color: "#dbdee1", fontSize: "13px", whiteSpace: "pre-wrap" }}>
            {this.state.error?.stack}
          </pre>
          {this.state.errorInfo && (
            <pre style={{ background: "#2b2d31", padding: "15px", borderRadius: "6px", color: "#949ba4", fontSize: "12px", marginTop: "10px", whiteSpace: "pre-wrap" }}>
              {this.state.errorInfo.componentStack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
