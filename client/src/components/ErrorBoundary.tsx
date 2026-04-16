'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrainCircuit, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private resetLink = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6">
          <div className="absolute inset-0 bg-gradient-to-br from-[#c799ff]/5 to-transparent pointer-events-none" />
          
          <div className="text-center relative z-10 p-8 glass rounded-3xl max-w-md w-full border border-white/10 shadow-2xl">
            <div className="relative mx-auto w-24 h-24 mb-6">
              <div className="absolute inset-0 bg-red-500/20 blur-[30px] rounded-full animate-pulse" />
              <BrainCircuit className="w-full h-full text-white/40 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] animate-bounce" />
            </div>
            
            <h1 className="text-display text-2xl font-bold text-white mb-2 tracking-tight">
              Neural Link Flickering
            </h1>
            <p className="text-white/40 text-sm mb-8 leading-relaxed">
              We encountered anomalous data streaming through the cortical node. 
              <br/>({this.state.error?.message})
            </p>

            <button
              onClick={this.resetLink}
              className="group flex items-center justify-center w-full gap-2 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95"
            >
              <RefreshCw className="w-4 h-4 text-white/60 group-hover:text-white group-hover:rotate-180 transition-all duration-500" />
              <span className="text-sm font-semibold tracking-wide text-white/80 group-hover:text-white">
                Reset Link
              </span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
