import { useEffect, useRef, useState, useCallback } from 'react';
import {
  parseRouteFromHash,
  serializeRoute,
  isValidTab,
  DEFAULT_TAB
} from '../utils/appNavigation.js';

export function useAppNavigation({ onSelectAsset, onClearAsset } = {}) {
  const onSelectAssetRef = useRef(onSelectAsset);
  onSelectAssetRef.current = onSelectAsset;

  const onClearAssetRef = useRef(onClearAsset);
  onClearAssetRef.current = onClearAsset;

  const initialRoute = parseRouteFromHash(typeof window !== 'undefined' ? window.location.hash : '');
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [selectedSymbol, setSelectedSymbol] = useState(initialRoute.symbol);
  const originTabRef = useRef(initialRoute.tab || DEFAULT_TAB);

  // Synchronize state on browser Back / Forward (hashchange)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onHashChange = () => {
      const route = parseRouteFromHash(window.location.hash);

      if (route.isFallback) {
        window.history.replaceState(null, '', serializeRoute(route));
      }

      if (route.symbol !== selectedSymbol) {
        setSelectedSymbol(route.symbol);
        if (route.symbol) {
          if (onSelectAssetRef.current) onSelectAssetRef.current(route.symbol);
        } else {
          if (onClearAssetRef.current) onClearAssetRef.current();
        }
      }

      if (route.tab !== activeTab) {
        setActiveTab(route.tab);
      }
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeTab, selectedSymbol]);

  // Initial bootstrap normalization and deep link trigger
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initial = parseRouteFromHash(window.location.hash);

    if (initial.isFallback) {
      window.history.replaceState(null, '', serializeRoute(initial));
    }

    if (initial.symbol && onSelectAssetRef.current) {
      onSelectAssetRef.current(initial.symbol);
    }
  }, []);

  const navigateTab = useCallback((tabId) => {
    const targetTab = isValidTab(tabId) ? tabId : DEFAULT_TAB;
    originTabRef.current = targetTab;

    if (selectedSymbol) {
      setSelectedSymbol(null);
      if (onClearAssetRef.current) onClearAssetRef.current();
    }

    setActiveTab(targetTab);

    if (typeof window !== 'undefined') {
      const targetHash = serializeRoute({ tab: targetTab, symbol: null });
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  }, [selectedSymbol]);

  const navigateToAsset = useCallback((symbol) => {
    if (!symbol || typeof symbol !== 'string') return;
    const cleanSymbol = symbol.trim();
    if (!cleanSymbol) return;

    originTabRef.current = activeTab;
    setSelectedSymbol(cleanSymbol);
    setActiveTab('assets');

    if (typeof window !== 'undefined') {
      const targetHash = serializeRoute({ tab: 'assets', symbol: cleanSymbol });
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }

    if (onSelectAssetRef.current) {
      onSelectAssetRef.current(cleanSymbol);
    }
  }, [activeTab]);

  const navigateBackFromAsset = useCallback(() => {
    const returnTab = originTabRef.current || 'assets';
    setSelectedSymbol(null);
    setActiveTab(returnTab);

    if (onClearAssetRef.current) {
      onClearAssetRef.current();
    }

    if (typeof window !== 'undefined') {
      const targetHash = serializeRoute({ tab: returnTab, symbol: null });
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    selectedSymbol,
    setSelectedSymbol,
    originTab: originTabRef.current,
    navigateTab,
    navigateToAsset,
    navigateBackFromAsset
  };
}
