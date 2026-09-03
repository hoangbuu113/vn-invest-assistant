import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthGate } from './components/AuthGate.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      {({ logout, user, profile }) => <App onLogout={logout} user={user} profile={profile} />}
    </AuthGate>
  </React.StrictMode>
);
