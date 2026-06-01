'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Clock, AlertTriangle, CheckCircle, X } from 'lucide-react';

export type NotificationPriority = 'low' | 'normal' | 'important' | 'urgent';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  scheduledFor?: number; // timestamp
  createdAt: number;
  isRead: boolean;
  actionType?: 'meeting' | 'reminder' | 'insight';
  memoryId?: string;
}

interface NotificationContextType {
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => void;
  removeNotification: (id: string) => void;
  notifications: AppNotification[];
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [visibleToasts, setVisibleToasts] = useState<AppNotification[]>([]);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('echomind_notifications');
      if (stored) {
        const parsed = JSON.parse(stored) as AppNotification[];
        // Filter out old low priority ones, keep important/urgent or scheduled ones
        const valid = parsed.filter(n => !n.isRead || n.scheduledFor);
        setNotifications(valid);
      } else {
        // DEMO RELIABILITY MODE: Preload polished examples
        const demoNotifications: AppNotification[] = [
          {
            id: 'demo-1',
            title: 'AI Presentation Review',
            message: 'You asked me to remind you about tomorrow\'s AI presentation slides.',
            priority: 'important',
            createdAt: Date.now(),
            isRead: false,
            actionType: 'reminder',
            scheduledFor: Date.now() + 10 * 60 * 1000 // 10 minutes from now
          },
          {
            id: 'demo-2',
            title: 'Meeting Summary Ready',
            message: '3 action items were identified in your sync with Rahul.',
            priority: 'normal',
            createdAt: Date.now(),
            isRead: false,
            actionType: 'meeting'
          }
        ];
        setNotifications(demoNotifications);
        setVisibleToasts([demoNotifications[1]]); // Show the meeting summary immediately
        
        // Auto dismiss demo toast after 8s
        setTimeout(() => {
          setVisibleToasts([]);
        }, 8000);
      }
    } catch (e) {
      console.warn("Quiet Recovery: Failed to parse notifications");
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('echomind_notifications', JSON.stringify(notifications));
    } catch (e) {
      // Quiet recovery
    }
  }, [notifications]);

  // Scheduler for proactive reminder windows
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNotifications(prev => {
        let changed = false;
        const next = prev.map(n => {
          if (n.scheduledFor && n.scheduledFor <= now && !n.isRead) {
            changed = true;
            // It's time to show this scheduled notification
            showToast({ ...n, isRead: true });
            return { ...n, isRead: true }; // Mark as read/shown so it doesn't trigger again
          }
          return n;
        });
        return changed ? next : prev;
      });
    }, 15000); // Check every 15s to avoid battery drain

    return () => clearInterval(interval);
  }, []);

  const showToast = useCallback((n: AppNotification) => {
    setVisibleToasts(prev => {
      // Duplicate prevention
      if (prev.some(t => t.id === n.id)) return prev;
      return [...prev, n];
    });

    // Auto dismiss after 6s
    setTimeout(() => {
      setVisibleToasts(prev => prev.filter(t => t.id !== n.id));
    }, 6000);
  }, []);

  const addNotification = useCallback((data: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => {
    const newNotif: AppNotification = {
      ...data,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: Date.now(),
      isRead: false,
    };

    setNotifications(prev => [...prev, newNotif]);

    // If it's not scheduled for the future, show immediately
    if (!data.scheduledFor || data.scheduledFor <= Date.now()) {
      showToast(newNotif);
    }
  }, [showToast]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    setVisibleToasts(prev => prev.filter(n => n.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ addNotification, removeNotification, notifications }}>
      {children}
      <NotificationCenter toasts={visibleToasts} onDismiss={removeNotification} />
    </NotificationContext.Provider>
  );
}

function NotificationCenter({ toasts, onDismiss }: { toasts: AppNotification[], onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 w-full max-w-sm px-4 pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`pointer-events-auto relative overflow-hidden glass-strong border rounded-2xl p-4 shadow-2xl flex items-start gap-3 backdrop-blur-xl ${getPriorityBorder(toast.priority)}`}
          >
            <div className={`mt-0.5 shrink-0 ${getPriorityColor(toast.priority)}`}>
              {getIcon(toast.priority)}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-white/90 truncate">{toast.title}</h4>
              <p className="text-xs text-white/60 mt-1 leading-relaxed">{toast.message}</p>
              
              {/* Notification Actions */}
              <div className="flex items-center gap-3 mt-3">
                <button 
                  onClick={() => onDismiss(toast.id)}
                  className="text-[10px] font-medium text-white/40 hover:text-white/80 transition-colors uppercase tracking-widest"
                >
                  Dismiss
                </button>
                {toast.actionType === 'meeting' && (
                  <button className="text-[10px] font-medium text-[#c799ff] hover:text-white transition-colors uppercase tracking-widest">
                    View Summary
                  </button>
                )}
                {toast.actionType === 'reminder' && (
                  <button className="text-[10px] font-medium text-[#4af8e3] hover:text-white transition-colors uppercase tracking-widest">
                    Mark Done
                  </button>
                )}
              </div>
            </div>
            <button 
              onClick={() => onDismiss(toast.id)}
              className="absolute top-3 right-3 text-white/20 hover:text-white/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function getPriorityColor(priority: NotificationPriority) {
  switch (priority) {
    case 'urgent': return 'text-red-400';
    case 'important': return 'text-amber-400';
    case 'normal': return 'text-[#4af8e3]';
    case 'low': return 'text-white/40';
  }
}

function getPriorityBorder(priority: NotificationPriority) {
  switch (priority) {
    case 'urgent': return 'border-red-500/30 bg-red-500/5';
    case 'important': return 'border-amber-500/30 bg-amber-500/5';
    case 'normal': return 'border-[#4af8e3]/30 bg-[#4af8e3]/5';
    case 'low': return 'border-white/10 bg-white/5';
  }
}

function getIcon(priority: NotificationPriority) {
  switch (priority) {
    case 'urgent': return <AlertTriangle className="w-4 h-4" />;
    case 'important': return <Clock className="w-4 h-4" />;
    case 'normal': return <CheckCircle className="w-4 h-4" />;
    case 'low': return <Bell className="w-4 h-4" />;
  }
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used within NotificationProvider");
  return context;
}
