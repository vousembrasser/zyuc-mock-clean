import { useState, useEffect } from 'react';

export interface SseEventData {
    requestId: string;
    payload: string;
    endpoint: string;
    defaultResponse: string;
    project: string;
}

export const useEventSource = (url: string) => {
    const [events, setEvents] = useState<SseEventData[]>([]);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // **直接连接到 Go 后端**
        const fullUrl = `http://localhost:8080${url}`;
        console.log(`Connecting EventSource to: ${fullUrl}`);

        const eventSource = new EventSource(fullUrl);

        eventSource.onopen = () => {
            console.log("EventSource connection established (onopen event).");
            // onopen 意味着底层连接成功，但不一定代表逻辑连接成功
        };

        eventSource.addEventListener('connected', () => {
            console.log("Received 'connected' event from server. Connection is fully active.");
            setIsConnected(true);
        });

        eventSource.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                setEvents(prev => [data, ...prev]);
            } catch (error) {
                console.error('Failed to parse SSE message:', error);
            }
        });

        eventSource.addEventListener('ping', () => {
            console.log('Received server ping.');
            // 收到心跳也意味着连接是活跃的
            if (!isConnected) {
                setIsConnected(true);
            }
        });

        eventSource.onerror = (error) => {
            console.error('EventSource connection error:', error);
            setIsConnected(false);
            eventSource.close();
        };

        return () => {
            console.log('Cleaning up and closing EventSource connection.');
            eventSource.close();
        };
    }, [url]); // 依赖项只有 url

    return { events, isConnected };
};