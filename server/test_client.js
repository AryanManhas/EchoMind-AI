const WebSocket = require('ws');
const fs = require('fs');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected to server');
  
  const audioStream = fs.createReadStream('test_audio.wav', { highWaterMark: 1024 * 16 });
  
  audioStream.on('data', (chunk) => {
    ws.send(chunk);
    console.log(`Sent ${chunk.length} bytes of audio`);
  });

  audioStream.on('end', () => {
    console.log('Finished streaming audio. Closing connection...');
    ws.close();
  });
});

ws.on('message', (data) => {
  console.log('Received from server:', data.toString());
});

ws.on('close', () => {
  console.log('Connection closed');
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});
