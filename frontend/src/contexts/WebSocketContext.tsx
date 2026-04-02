"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface WebSocketContextType {
  ws: WebSocket | null;
  connect: (projectId: string, apiKey: string) => void;
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
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const connect = (projectId: string, apiKey: string) => {
    if (ws) {
      return; // Already connected or connecting
    }

    setStatus('connecting');
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080"}/api/gcp/stream-pubsub-ws?project=${projectId}&token=${apiKey}`;

    console.log('Connecting to WebSocket:', wsUrl);
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log('WebSocket connected');
      setStatus('connected');
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
      setStatus('disconnected');
      setWs(null);
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('error');
      // onclose will handle cleanup
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