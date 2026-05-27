import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import MobileApp from './MobileApp.jsx'

// Show mobile layout for screens narrower than 768px
const isMobile = window.matchMedia('(max-width: 768px)').matches;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMobile ? <MobileApp /> : <App />}
  </React.StrictMode>
)
