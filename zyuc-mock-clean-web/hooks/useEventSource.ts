import { useState, useEffect } from 'react';

function getBootstrapUrl(): string {
    if (typeof window !== 'undefined' && (window as any).APP_CONFIG) {
        return (window as any).APP_CONFIG.apiBaseUrl;
    }
    return 'http://localhost:8080'; 
}


export interface SseEventData {
    requestId: string;
    payload: string;
    endpoint: string;
    defaultResponse: string;
    project: string;
    source: string; 
}


export const useEventSource = (bootstrapUrl: string) => {
    const [events, setEvents] = useState<SseEventData[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});
    const [allServices, setAllServices] = useState<string[]>([]);
    const [primaryService, setPrimaryService] = useState<string | null>(null);

    useEffect(() => {
        if (!bootstrapUrl) return;

        let isMounted = true;
        
        const fetchAndConnect = async () => {
            try {
                const response = await fetch(`${bootstrapUrl}/api/services`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch service list: ${response.statusText}`);
                }
                const { primary, services } = await response.json();
                
                if (!isMounted) return;

                const activeServices = services || [];
                setAllServices(activeServices);
                setPrimaryService(primary || null);

                // Update status for all active services
                const newStatus: Record<string, boolean> = {};
                activeServices.forEach((s: string) => {
                    newStatus[s] = true; // If it's in the list, it's active
                });
                setConnectionStatus(newStatus);

            } catch (error) {
                console.error("Error polling for services:", error);
                if(isMounted) {
                    const host = new URL(bootstrapUrl).host;
                    setAllServices([host]);
                    setPrimaryService(host); // Assume bootstrap is primary on error
                    setConnectionStatus({[host]: true}); // At least show bootstrap as online
                }
            }
        };

        fetchAndConnect();
        const intervalId = setInterval(fetchAndConnect, 7000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [bootstrapUrl]);

    useEffect(() => {
        setEvents([]);

        if (!primaryService) {
            return;
        }
        
        const protocol = new URL(bootstrapUrl).protocol; 
        const fullUrl = `${protocol}//${primaryService}/api/events?mode=interactive`;
        
        console.log(`Connecting EventSource to primary: ${fullUrl}`);
        const eventSource = new EventSource(fullUrl);

        eventSource.onopen = () => {
            console.log(`EventSource connection established to primary ${primaryService}`);
            // SSE connection status is a layer on top of general service status
            // We can keep this for more detailed debugging if needed
        };

        eventSource.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                setEvents(prev => [data, ...prev]);
            } catch (error) {
                console.error(`Failed to parse SSE message from ${primaryService}:`, error);
            }
        });
        
        eventSource.addEventListener('ping', () => {
             // A ping confirms the primary is still responsive
        });

        eventSource.onerror = (error) => {
            console.error(`EventSource connection error for ${primaryService}:`, error);
            // Don't set the primary's status to false here,
            // let the polling mechanism handle service availability.
            eventSource.close();
        };

        return () => {
            console.log(`Cleaning up and closing EventSource connection to ${primaryService}.`);
            eventSource.close();
        };
    }, [primaryService, bootstrapUrl]);

    // The status of non-primary nodes now comes directly from the polling API
    return { events, connectionStatus, allServices, primaryService };
};