// This script is for non-interactive pages like config, history, etc.
// It establishes a "background" SSE connection to ensure the Go process
// knows a client is active, but it does not receive mock request events.

console.log("Establishing keep-alive SSE connection.");
const keepAliveSource = new EventSource('/api/events?mode=keep-alive');

keepAliveSource.onopen = () => {
    console.log("Keep-alive SSE connection established.");
};

keepAliveSource.onerror = (err) => {
    console.error("Keep-alive SSE connection error:", err);
};