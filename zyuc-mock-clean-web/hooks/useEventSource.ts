import { useState, useEffect } from 'react';

export interface SseEventData {
    requestId: string;
    payload: string;
    endpoint: string;
    defaultResponse: string;
    project: string;
    source: string; // The address of the backend that sent this event
}

export const useEventSource = (urls: string[]) => {
    const [events, setEvents] = useState<SseEventData[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setEvents([]);
        const initialStatus: Record<string, boolean> = {};
        urls.forEach(url => {
            initialStatus[url] = false;
        });
        setConnectionStatus(initialStatus);

        if (!urls || urls.length === 0) {
            return;
        }

        const eventSources: EventSource[] = urls.map(url => {
            // url is now expected to be '127.0.0.1:8080'
            const fullUrl = `http://${url}/api/events?mode=interactive`;
            console.log(`Connecting EventSource to: ${fullUrl}`);
            const eventSource = new EventSource(fullUrl);

            eventSource.onopen = () => {
                console.log(`EventSource connection established to ${url}`);
                setConnectionStatus(prev => ({ ...prev, [url]: true }));
            };

            eventSource.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // The 'source' from the backend is already the correct address
                    setEvents(prev => [data, ...prev]);
                } catch (error) {
                    console.error(`Failed to parse SSE message from ${url}:`, error);
                }
            });
            
            eventSource.addEventListener('ping', () => {
                 setConnectionStatus(prev => ({ ...prev, [url]: true }));
            });

            eventSource.onerror = (error) => {
                console.error(`EventSource connection error for ${url}:`, error);
                setConnectionStatus(prev => ({ ...prev, [url]: false }));
                eventSource.close();
            };

            return eventSource;
        });

        return () => {
            console.log('Cleaning up and closing all EventSource connections.');
            eventSources.forEach(es => es.close());
        };
    }, [JSON.stringify(urls)]); // Use JSON.stringify to compare array values

    return { events, connectionStatus };
};