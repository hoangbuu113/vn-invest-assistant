import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { OwnerGate } from './components/OwnerGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OwnerGate>
      {({ lock }) => <App onLock={lock} />}
    </OwnerGate>
  </React.StrictMode>
);
