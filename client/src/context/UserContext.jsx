import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getCurrentUserId, setCurrentUserId } from '../api/client.js';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [currentUserId, setUserIdState] = useState(getCurrentUserId());
  const [loading, setLoading] = useState(true);

  const refreshUsers = useCallback(async () => {
    try {
      const list = await api.get('/users');
      setUsers(list);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  const selectUser = (userId) => {
    setCurrentUserId(userId);
    setUserIdState(userId);
  };

  const currentUser = users.find((u) => u.user_id === currentUserId) ?? null;

  return (
    <UserContext.Provider value={{ users, currentUser, currentUserId, selectUser, refreshUsers, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
