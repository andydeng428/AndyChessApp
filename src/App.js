import React, { useState, useEffect, useCallback, useRef } from 'react';
import Chessboard from 'chessboardjsx';
import { Chess } from 'chess.js';
import axios from 'axios';
import io from 'socket.io-client';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import './App.css';

console.log('Engine status URL:',`${process.env.REACT_APP_BACKEND_URL}/api/engine-status`);


// Chessboard Component with Reset Button
const ChessboardSection = ({ 
  fen, 
  onMove, 
  isPlayerTurn, 
  engineStatus,
  onResetBoard 
}) => {
  return (
    <div className="chessboard-wrapper">
      <Chessboard
        position={fen}
        onDrop={({ sourceSquare, targetSquare }) => 
          onMove(sourceSquare, targetSquare)
        }
        width={500}
        orientation="white"
        draggable={isPlayerTurn && engineStatus === 'ready'}
      />
      <div className="reset-board-container">
        <button 
          onClick={onResetBoard} 
          className="reset-board-btn"
        >
          Reset Board
        </button>
      </div>
    </div>
  );
};

// Terminal Component with Xterm.js
const EngineTerminal = ({ 
  engineLogs, 
  clearLogs 
}) => {
  const terminalRef = useRef(null);
  const terminalInstance = useRef(null);
  const fitAddon = useRef(null);

  useEffect(() => {
    // Initialize terminal with adjusted settings
    if (terminalRef.current && !terminalInstance.current) {
      terminalInstance.current = new Terminal({
        cols: 250,
        convertEol: true,
        scrollback: 1000,
        disableStdin: true,
        fontSize: 12,
        fontFamily: "'Cascadia Code', 'Cascadia Mono', monospace",
        theme: {
          background: '#1E1E1E',     // Default Linux terminal black
          foreground: '#C0C0C0',     // Classic Linux terminal green text
          cursor: '#00FF00'          // Green cursor
        }
      });

      fitAddon.current = new FitAddon();
      terminalInstance.current.loadAddon(fitAddon.current);

      terminalInstance.current.open(terminalRef.current);
      fitAddon.current.fit();

      // Add custom key handler for clearing logs
      terminalInstance.current.onKey(({ key, domEvent }) => {
        if (domEvent.ctrlKey && domEvent.key === 'l') {
          clearLogs();
          terminalInstance.current.clear();
        }
      });
    }

    return () => {
      if (terminalInstance.current) {
        terminalInstance.current.dispose();
        terminalInstance.current = null;
      }
    };
  }, [clearLogs]);

  const writtenLogsCount = useRef(0);
  // Effect to update terminal logs with adjusted line wrapping
  useEffect(() => {
    if (terminalInstance.current) {
      // Retrieve only the new logs that haven't been written yet
      const newLogs = engineLogs.slice(writtenLogsCount.current);
  
      newLogs.forEach(log => {
        let color = '\x1b[37m';  
        switch (log.type) {
          case 'welcome':
            color = '\x1b[36m'; // Cyan for welcome messages
            break;
          case 'error':
            color = '\x1b[31m'; // Red for errors
            break;
          case 'engine':
            color = '\x1b[32m'; // Green for engine logs
            break;
          default:
            color = '\x1b[37m'; // White for unknown log types
            break;
        }
  
        // Directly write the log message without wrapping or clearing
        terminalInstance.current.writeln(`${color}${log.message}\x1b[0m`);
      });
  
      // Update the count of logs that have been written
      writtenLogsCount.current = engineLogs.length;
  
      // Scroll to bottom after writing new logs
      terminalInstance.current.scrollToBottom();
    }
  }, [engineLogs]);

  // Helper function to wrap text

  return (
    <div className="terminal-wrapper">
      <div 
        ref={terminalRef} 
        className="xterm-container"
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
};

// Main App Component
function App() {
  const [chess, setChess] = useState(new Chess());
  const [fen, setFen] = useState(chess.fen());
  const [engineStatus, setEngineStatus] = useState('loading');
  const [engineLogs, setEngineLogs] = useState([]);
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);

  const [welcomeShown, setWelcomeShown] = useState(false);

  // Socket Connection Effect
  useEffect(() => {
    const newSocket = io(process.env.REACT_APP_BACKEND_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Handle welcome message
    newSocket.on('welcomeMessage', (message) => {
      if (!welcomeShown) {
        setEngineLogs(prevLogs => [
          ...prevLogs,
          { type: 'welcome', message: message.ascii },
          { type: 'welcome', message: message.description }
        ]);
        setWelcomeShown(true);
      }
    });

    // Raw engine log handler
    newSocket.on('rawEngineLog', (logMessage) => {
      // Only add non-empty log messages
      if (logMessage && logMessage.trim() !== '') {
        setEngineLogs(prevLogs => [
          ...prevLogs, 
          { 
            type: 'engine', 
            message: logMessage.trim(),
            timestamp: new Date().toISOString()
          }
        ]);
      }
    });

    return () => {
      newSocket.off('welcomeMessage');
      newSocket.off('rawEngineLog');
      newSocket.close();
    };
  }, [welcomeShown]);

  // Check Engine Status
  const checkEngineStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/engine-status`, 
        {
          headers: {
            'ngrok-skip-browser-warning': '1'
          }
        });
      
      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'info', 
          message: `Engine status: ${response.data.status}`,
          timestamp: new Date().toISOString()
        }
      ]);

      setEngineStatus(response.data.status);
    } catch (error) {
      console.error('Engine status check failed:', error);
      
      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'error', 
          message: `Status check failed: ${error.message}`,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, []);

  // Initial Engine Status Check
  useEffect(() => {
    checkEngineStatus();
  }, [checkEngineStatus]);

  // Request Engine Move
  const requestEngineMove = useCallback(async () => {
    try {
      setIsPlayerTurn(false);
      
      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'info', 
          message: 'Requesting engine move',
          timestamp: new Date().toISOString()
        }
      ]);
      
      const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/engine-move`, { 
        fen: chess.fen() 
      },{
        headers: {
          'ngrok-skip-browser-warning': '1'
        }
      });
      
      const engineMove = response.data.move;

      if (!engineMove) {
        throw new Error('No move received from engine');
      }

      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'info', 
          message: `Engine move: ${engineMove}`,
          timestamp: new Date().toISOString()
        }
      ]);

      const moveResult = chess.move(engineMove, { sloppy: true });
      
      if (!moveResult) {
        throw new Error(`Invalid engine move: ${engineMove}`);
      }
      
      setFen(chess.fen());
      setIsPlayerTurn(true);
    } catch (error) {
      console.error('Engine Move Error:', error);
      
      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'error', 
          message: `Move generation failed: ${error.message}`,
          timestamp: new Date().toISOString()
        }
      ]);

      setIsPlayerTurn(true);
    }
  }, [chess]);

  // Handle Player Move
  const handleMove = useCallback((sourceSquare, targetSquare) => {
    if (!isPlayerTurn || engineStatus !== 'ready') {
      return;
    }

    try {
      const move = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q'
      });

      if (move) {
        setEngineLogs(prevLogs => [
          ...prevLogs, 
          { 
            type: 'info', 
            message: `Player move: ${move.san}`,
            timestamp: new Date().toISOString()
          }
        ]);

        setFen(chess.fen());
        setTimeout(requestEngineMove, 500);
      }
    } catch (error) {
      console.error('Move Error:', error);
    }
  }, [isPlayerTurn, engineStatus, chess, requestEngineMove]);

  // Reset Board
  const handleResetBoard = useCallback(async () => {
    const newChess = new Chess();
    setChess(newChess);
    setFen(newChess.fen());
    
    try {
      await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/engine-move`, { 
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' 
      }, {
        headers: {
          'ngrok-skip-browser-warning': '1'
        }
      });

      setEngineLogs(prevLogs => [
        ...prevLogs, 
        { 
          type: 'info', 
          message: 'Board reset to starting position',
          timestamp: new Date().toISOString()
        }
      ]);
    } catch (error) {
      console.error('Reset board error:', error);
    }
  }, []);

  // Clear Logs
  const clearLogs = useCallback(() => {
    setEngineLogs([]);
  }, []);

  return (
    <div className="chess-app">
      <div className="game-container">
        <ChessboardSection 
          fen={fen}
          onMove={handleMove}
          isPlayerTurn={isPlayerTurn}
          engineStatus={engineStatus}
          onResetBoard={handleResetBoard}
        />
        <EngineTerminal 
          engineLogs={engineLogs}
          clearLogs={clearLogs}
        />
      </div>
    </div>
  );
}

export default App;