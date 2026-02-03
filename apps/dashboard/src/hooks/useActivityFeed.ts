'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface ActivityEvent {
  id: string;
  time: Date;
  action: string;
  status: 'success' | 'adapt' | 'warning' | 'shield' | 'error';
  txSig?: string;
}

export interface ActivityContextType {
  activities: ActivityEvent[];
  addActivity: (event: Omit<ActivityEvent, 'id' | 'time'>) => void;
  clearActivities: () => void;
}

export const ActivityContext = createContext<ActivityContextType>({
  activities: [],
  addActivity: () => {},
  clearActivities: () => {},
});

export function useActivityFeedState(): ActivityContextType {
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const counterRef = useRef(0);

  const addActivity = useCallback((event: Omit<ActivityEvent, 'id' | 'time'>) => {
    counterRef.current += 1;
    const newEvent: ActivityEvent = {
      ...event,
      id: `${Date.now()}-${counterRef.current}`,
      time: new Date(),
    };
    setActivities(prev => [newEvent, ...prev].slice(0, 50));
  }, []);

  const clearActivities = useCallback(() => {
    setActivities([]);
  }, []);

  return { activities, addActivity, clearActivities };
}

export function useActivityFeed() {
  return useContext(ActivityContext);
}
