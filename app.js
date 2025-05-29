document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const disconnectButton = document.getElementById('disconnectButton');
    const chatMessages = document.getElementById('chatMessages');
    const statusIndicator = document.getElementById('statusIndicator');
    const userCountDisplay = document.getElementById('userCount');
    const typingIndicator = document.getElementById('typingIndicator');
    const chatWindowWrapper = document.querySelector('.chat-window-wrapper');

    let socket;
    let isConnectedToPartner = false;
    let typingTimeout;

    function connectWebSocket() {
        // Use wss:// for secure connections on deployed sites
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        socket = new WebSocket(protocol + window.location.host);

        socket.onopen = () => {
            console.log('WebSocket connection established');
            // Status is updated by server messages
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'userCount':
                        userCountDisplay.textContent = `${data.count} user${data.count === 1 ? '' : 's'} online`;
                        break;
                    case 'status':
                        handleStatusUpdate(data.message);
                        break;
                    case 'chatMessage':
                        addMessageToChat(data.content, data.sender);
                        break;
                    case 'typing':
                        showTypingIndicator(data.isTyping);
                        break;
                    default:
                        console.log('Unknown message type:', data.type);
                }
            } catch (e) {
                console.error("Error parsing message data:", e, "Raw data:", event.data);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket connection closed');
            statusIndicator.textContent = 'Disconnected from server. Attempting to reconnect...';
            disableChat();
            isConnectedToPartner = false;
            // Optional: Implement reconnect logic with backoff
            setTimeout(connectWebSocket, 5000); // Try to reconnect every 5 seconds
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            statusIndicator.textContent = 'Connection error. Please refresh.';
            disableChat();
        };
    }

    function handleStatusUpdate(statusMsg) {
        console.log("Status:", statusMsg);
        switch (statusMsg) {
            case 'connectedToServer':
                statusIndicator.textContent = 'Connected to server. Finding a partner...';
                break;
            case 'waiting':
                statusIndicator.textContent = 'Waiting for a partner...';
                clearChatMessages();
                disableChat();
                isConnectedToPartner = false;
                break;
            case 'paired':
                statusIndicator.textContent = 'You are connected to someone!';
                enableChat();
                isConnectedToPartner = true;
                break;
            case 'partnerDisconnected':
                statusIndicator.textContent = 'Your partner disconnected. Waiting for a new one...';
                addSystemMessage('Your partner has disconnected.');
                disableChat();
                isConnectedToPartner = false;
                // Server should automatically put this client back into waiting queue.
                break;
            case 'disconnectedFromPartner': // Client itself initiated disconnect
                statusIndicator.textContent = 'You disconnected. Finding a new partner...';
                // Server will put this client back to waiting
                disableChat();
                isConnectedToPartner = false;
                break;
        }
    }

    function addMessageToChat(message, sender) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message-bubble');
        messageElement.classList.add(sender === 'me' ? 'my-message' : 'their-message');
        messageElement.textContent = message; // Safely sets text content
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }

    function addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('status-indicator'); // Reuse status style for system messages
        messageElement.style.textAlign = 'center';
        messageElement.style.opacity = '0.8';
        messageElement.style.margin = '10px 0';
        messageElement.textContent = message;
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }

    function clearChatMessages() {
        chatMessages.innerHTML = '';
    }

    function scrollToBottom() {
        chatWindowWrapper.scrollTop = chatWindowWrapper.scrollHeight;
    }

    function enableChat() {
        messageInput.disabled = false;
        sendButton.disabled = false;
        disconnectButton.disabled = false;
        messageInput.placeholder = "Type a message...";
        messageInput.focus(); // Focus input when chat is enabled
    }

    function disableChat() {
        messageInput.disabled = true;
        sendButton.disabled = true;
        // Keep disconnect button enabled if connected to server but not partner?
        // For now, it's mainly for partner disconnect, so disable if not paired.
        disconnectButton.disabled = true;
        messageInput.placeholder = "Waiting for connection...";
        showTypingIndicator(false); // Clear typing indicator
    }

    function showTypingIndicator(isTyping) {
        if (isTyping) {
            typingIndicator.textContent = 'The other person is typing...';
        } else {
            typingIndicator.textContent = '';
        }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && socket && socket.readyState === WebSocket.OPEN && isConnectedToPartner) {
            socket.send(JSON.stringify({ type: 'chatMessage', content: message }));
            addMessageToChat(message, 'me');
            messageInput.value = '';
            // Stop sending typing indicator
            if (typingTimeout) clearTimeout(typingTimeout);
            socket.send(JSON.stringify({ type: 'typing', isTyping: false }));
            isCurrentlyTyping = false; // Reset typing state
        }
    }

    disconnectButton.addEventListener('click', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            if (isConnectedToPartner) {
                socket.send(JSON.stringify({ type: 'disconnectMe' }));
                addSystemMessage('You have disconnected from the chat.');
                // Status update will come from server to set to 'waiting'
            } else {
                 console.log("Not connected to a partner, disconnect button does nothing specific yet in this state.");
            }
        }
    });

    let isCurrentlyTyping = false;
    messageInput.addEventListener('input', () => {
        if (socket && socket.readyState === WebSocket.OPEN && isConnectedToPartner) {
            if (!isCurrentlyTyping) {
                socket.send(JSON.stringify({ type: 'typing', isTyping: true }));
                isCurrentlyTyping = true;
            }
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                if(isCurrentlyTyping) { // Only send if still considered typing
                    socket.send(JSON.stringify({ type: 'typing', isTyping: false }));
                    isCurrentlyTyping = false;
                }
            }, 2000); // Send 'not typing' if no input for 2 seconds
        }
    });
    
    // Initial setup
    connectWebSocket();
    disableChat(); // Start with chat disabled
});
