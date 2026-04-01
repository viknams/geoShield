"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

interface WebSocketContextType {
  ws: WebSocket | null;
  connect: (projectId: string) => void;
  disconnect: () => void;
  latestMessage: any;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const projectIdRef = useRef<string | null>(null);

  const connect = (projectId: string) => {
    if (ws && projectId === projectIdRef.current) {
      return; // Already connected to the same project
    }

    if (ws) {
      ws.close(); // Close existing connection if project changes
    }

    projectIdRef.current = projectId;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const wsUrl = `${apiUrl.replace(/^http/, 'ws')}/api/gcp/stream-pubsub-ws?project=${projectId}`;

    console.log('Connecting to WebSocket:', wsUrl);
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log('WebSocket connected');
      setWs(newWs);
    };

    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
       if (data.attributes) {
           setLatestMessage(data);
       }
    };

    newWs.onclose = () => {
      console.log('WebSocket disconnected');
      setWs(null);
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      // No need to setWs(null) here, onclose will handle it
    };
  };

  const disconnect = () => {
    if (ws) {
      console.log('Disconnecting WebSocket');
      ws.close();
      setWs(null);
    }
  };

  return (
    <WebSocketContext.Provider value={{ ws, connect, disconnect, latestMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
};