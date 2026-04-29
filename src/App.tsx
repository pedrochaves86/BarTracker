import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Minus, UserPlus, Trash2, RotateCcw, Beer, Settings2, X, ChevronUp, ChevronDown, Star, Share2, Users, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { db } from './firebase';

interface MenuItem {
  id: string;
  label: string;
  price: number;
  isFavorite?: boolean;
}

interface Friend {
  id: string;
  name: string;
  counts: Record<string, number>;
}

const INITIAL_MENU: MenuItem[] = [
  { id: 'fino', label: 'Fino', price: 1.1, isFavorite: true },
  { id: 'tulipa', label: 'Tulipa', price: 1.8 },
  { id: 'caneca', label: 'Caneca', price: 2.5 },
  { id: 'tremocos', label: 'Tremoços', price: 1.0, isFavorite: true },
  { id: 'mistura', label: 'Mistura', price: 1.0 },
];

const ROOM_ID_REGEX = /^[A-Z2-9]{4}$/;

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);

  const [newName, setNewName] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [resetState, setResetState] = useState<'idle' | 'confirm'>('idle');
  const [isFooterExpanded, setIsFooterExpanded] = useState(false);
  const [friendToDelete, setFriendToDelete] = useState<string | null>(null);

  // Room Management
  useEffect(() => {
    let hash = window.location.hash.replace('#', '').toUpperCase();
    if (!ROOM_ID_REGEX.test(hash)) {
      hash = generateRoomId();
      window.location.hash = hash;
    }
    setRoomId(hash);
  }, []);

  // Firebase Sync
  useEffect(() => {
    if (!roomId) return;

    setLoading(true);

    // Ensure session exists
    const sessionDoc = doc(db, 'sessions', roomId);
    getDoc(sessionDoc).then(docSnap => {
      if (!docSnap.exists()) {
        setDoc(sessionDoc, { createdAt: serverTimestamp() });
        // Seed initial menu for new rooms
        INITIAL_MENU.forEach(item => {
          setDoc(doc(db, 'sessions', roomId, 'menu', item.id), item);
        });
      }
    });

    const friendsRef = collection(db, 'sessions', roomId, 'friends');
    const menuRef = collection(db, 'sessions', roomId, 'menu');

    const unsubFriends = onSnapshot(query(friendsRef), (snapshot) => {
      const friendsData = snapshot.docs.map(doc => ({ ...doc.data() } as Friend));
      setFriends(friendsData);
    });

    const unsubMenu = onSnapshot(query(menuRef), (snapshot) => {
      const menuData = snapshot.docs.map(doc => ({ ...doc.data() } as MenuItem));
      // Sort by label for consistency if desired, or ID
      setMenu(menuData);
      setLoading(false);
    });

    return () => {
      unsubFriends();
      unsubMenu();
    };
  }, [roomId]);

  // Reset timers
  useEffect(() => {
    if (resetState === 'confirm') {
      const timer = setTimeout(() => setResetState('idle'), 3000);
      return () => clearTimeout(timer);
    }
  }, [resetState]);

  useEffect(() => {
    if (friendToDelete) {
      const timer = setTimeout(() => setFriendToDelete(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [friendToDelete]);

  // Actions (Updated for Firebase)
  const addFriend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newName.trim() || !roomId) return;
    const id = crypto.randomUUID();
    const newFriend: Friend = { id, name: newName.trim(), counts: {} };
    await setDoc(doc(db, 'sessions', roomId, 'friends', id), newFriend);
    setNewName('');
  };

  const addMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !roomId) return;
    const id = crypto.randomUUID();
    const price = Math.max(0, newItemPrice);
    const newItem: MenuItem = { id, label: newItemName.trim(), price };
    await setDoc(doc(db, 'sessions', roomId, 'menu', id), newItem);
    setNewItemName('');
    setNewItemPrice(0);
  };

  const removeMenuItem = async (id: string) => {
    if (!roomId) return;
    if (confirm('Remover este item? Os registos dos teus amigos para este item serão apagados.')) {
      await deleteDoc(doc(db, 'sessions', roomId, 'menu', id));
      // Optionally clean up friend counts, but Firestore rules or simple UI filtering handles cases where item is gone
      friends.forEach(async f => {
        if (f.counts[id]) {
          const newCounts = { ...f.counts };
          delete newCounts[id];
          await setDoc(doc(db, 'sessions', roomId, 'friends', f.id), { ...f, counts: newCounts });
        }
      });
    }
  };

  const updateItemPrice = async (id: string, price: number) => {
    if (!roomId || itemTotals[id] > 0) return;
    const safePrice = Math.max(0, price);
    const item = menu.find(m => m.id === id);
    if (item) {
      await setDoc(doc(db, 'sessions', roomId, 'menu', id), { ...item, price: safePrice });
    }
  };

  const toggleFavorite = async (id: string) => {
    if (!roomId) return;
    const item = menu.find(m => m.id === id);
    if (item) {
      await setDoc(doc(db, 'sessions', roomId, 'menu', id), { ...item, isFavorite: !item.isFavorite });
    }
  };

  const updateCount = async (friendId: string, itemId: string, delta: number) => {
    if (!roomId) return;
    const item = menu.find(m => m.id === itemId);
    if (delta > 0 && (!item || item.price <= 0)) return;

    const friend = friends.find(f => f.id === friendId);
    if (!friend) return;

    const current = friend.counts[itemId] || 0;
    const newCount = Math.max(0, current + delta);
    
    await setDoc(doc(db, 'sessions', roomId, 'friends', friendId), {
      ...friend,
      counts: {
        ...friend.counts,
        [itemId]: newCount,
      }
    });
  };

  const removeFriend = async (id: string) => {
    if (!roomId) return;
    if (friendToDelete === id) {
      await deleteDoc(doc(db, 'sessions', roomId, 'friends', id));
      setFriendToDelete(null);
    } else {
      setFriendToDelete(id);
    }
  };

  const handleReset = async () => {
    if (!roomId) return;
    if (resetState === 'idle') {
      setResetState('confirm');
    } else {
      // Delete all friends for reset
      friends.forEach(async f => {
        await deleteDoc(doc(db, 'sessions', roomId, 'friends', f.id));
      });
      setResetState('idle');
    }
  };

  const shareLink = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'BarTracker - Mesa #' + roomId,
          text: 'Vem acompanhar o consumo da mesa connosco!',
          url: url,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          copyToClipboard(url);
        }
      }
    } else {
      copyToClipboard(url);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  // Calculations
  const itemTotals = useMemo(() => {
    return menu.reduce((acc: Record<string, number>, item) => {
      acc[item.id] = friends.reduce((sum: number, f) => sum + (f.counts[item.id] || 0), 0);
      return acc;
    }, {});
  }, [friends, menu]);

  const grandTotal = useMemo(() => {
    return menu.reduce((sum: number, item) => sum + (itemTotals[item.id] || 0) * item.price, 0);
  }, [itemTotals, menu]);

  const getFriendTotalCost = (friend: Friend) => {
    return menu.reduce((sum: number, item) => sum + (friend.counts[item.id] || 0) * item.price, 0);
  };

  const getVisibleItemsForFriend = (friend: Friend) => {
    return menu.filter(item => 
      item.isFavorite || 
      (friend.counts[item.id] && friend.counts[item.id] > 0)
    ).sort((a, b) => a.label.localeCompare(b.label));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="text-amber-500"
        >
          <Beer size={48} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-neutral-200 px-4 py-4 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
              <Beer size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-none text-neutral-900">BarTracker</h1>
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-black">Mesa #{roomId}</p>
                <button 
                  onClick={shareLink}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full transition-all text-[8px] font-black uppercase tracking-tighter ${copying ? 'bg-green-100 text-green-600' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                >
                  {copying ? <Check size={8} strokeWidth={4} /> : <Share2 size={8} strokeWidth={4} />}
                  {copying ? 'Copiado' : 'Partilhar'}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2.5 rounded-full transition-all ${showSettings ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:bg-neutral-100'}`}
              id="settings-trigger"
            >
              <Settings2 size={20} />
            </button>
            <button 
              onClick={handleReset}
              className={`p-2.5 rounded-full transition-all flex items-center shadow-sm border ${resetState === 'confirm' ? 'bg-red-500 text-white border-red-500' : 'text-neutral-400 bg-white border-neutral-200 hover:text-red-50'}`}
              id="reset-trigger"
            >
              {resetState === 'confirm' ? (
                <span className="text-[10px] font-black uppercase px-2">Limpar?</span>
              ) : (
                <RotateCcw size={20} />
              )}
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }} 
              animate={{ height: 'auto', opacity: 1 }} 
              exit={{ height: 0, opacity: 0 }}
              className="max-w-md mx-auto overflow-hidden"
              id="settings-panel"
            >
              <div className="pt-6 pb-2 space-y-4 border-t border-neutral-100 mt-4 px-4">
                <h3 className="text-[11px] font-black uppercase text-neutral-400 tracking-widest">Configurar Itens</h3>
                
                <form onSubmit={addMenuItem} className="flex gap-2" id="add-menu-item-form">
                  <input
                    type="text"
                    placeholder="Nome"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="flex-1 bg-neutral-100 border-none rounded-full px-4 py-2 text-sm font-medium outline-none"
                  />
                  <div className="relative w-20">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="€"
                      value={newItemPrice || ''}
                      onChange={(e) => setNewItemPrice(parseFloat(e.target.value) || 0)}
                      className="w-full bg-neutral-100 border-none rounded-full px-4 py-2 text-sm font-bold outline-none pr-6"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400 font-bold">€</span>
                  </div>
                  <button type="submit" className="bg-amber-500 text-white p-2 rounded-full shadow-md active:scale-90" id="add-item-btn">
                    <Plus size={20} />
                  </button>
                </form>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {menu.sort((a, b) => a.label.localeCompare(b.label)).map(item => (
                    <div key={item.id} className="flex items-center justify-between bg-white border border-neutral-200 p-3 rounded-2xl shadow-sm" id={`menu-item-${item.id}`}>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-neutral-700 leading-tight">{item.label}</span>
                        {item.isFavorite && (
                          <span className="text-[8px] uppercase font-black text-amber-500 tracking-tighter">Padrão</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative w-20">
                          <input 
                            type="number"
                            step="0.1"
                            min="0"
                            value={item.price}
                            onChange={(e) => updateItemPrice(item.id, parseFloat(e.target.value) || 0)}
                            readOnly={itemTotals[item.id] > 0}
                            className={`w-full text-right text-[10px] font-black bg-neutral-50 px-2 py-1 rounded-lg outline-none transition-all ${itemTotals[item.id] > 0 ? 'text-neutral-400 cursor-not-allowed opacity-60' : 'text-amber-600'}`}
                            id={`price-input-${item.id}`}
                          />
                          <span className={`absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold ${itemTotals[item.id] > 0 ? 'text-neutral-300' : 'text-amber-600/50'}`}>
                            {itemTotals[item.id] > 0 ? '🔒' : '€'}
                          </span>
                        </div>
                        <button 
                          onClick={() => toggleFavorite(item.id)}
                          className={`p-1.5 rounded-full transition-colors ${item.isFavorite ? 'text-amber-500 bg-amber-50' : 'text-neutral-200 hover:text-amber-300'}`}
                          id={`favorite-item-${item.id}`}
                        >
                          <Star size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
                        </button>
                        <button 
                          onClick={() => removeMenuItem(item.id)} 
                          className="text-neutral-200 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 transition-colors" 
                          id={`remove-item-${item.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Add Friend - Smaller */}
        <form onSubmit={addFriend} className="flex gap-2" id="add-friend-form">
          <input
            id="new-friend"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Quem entrou na mesa?"
            className="flex-1 bg-white border border-neutral-200 rounded-full px-5 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20 shadow-sm font-semibold text-sm"
          />
          <button
            type="submit"
            className="bg-neutral-900 text-white p-2.5 rounded-full shadow-lg active:scale-95 transition-all flex items-center justify-center min-w-[44px]"
            id="add-friend-button"
          >
            <UserPlus size={20} />
          </button>
        </form>

        {/* Friends List */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {friends.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="text-center py-24 bg-white rounded-[40px] border border-dashed border-neutral-300 flex flex-col items-center justify-center"
                id="empty-list"
              >
                <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center text-neutral-200 mb-4">
                    <Beer size={32} />
                </div>
                <p className="text-neutral-400 text-sm font-bold uppercase tracking-widest">Mesa vazia</p>
                <p className="text-neutral-300 text-[10px] mt-1">Adiciona um nome acima!</p>
                <div className="mt-8 flex flex-col items-center gap-2">
                   <p className="text-[10px] text-neutral-400 font-bold uppercase">Ou partilha o link:</p>
                   <button onClick={shareLink} className="flex items-center gap-2 bg-neutral-100 px-4 py-2 rounded-full text-xs font-black text-neutral-600 hover:bg-neutral-200">
                     <Share2 size={12} /> Partilhar Mesa
                   </button>
                </div>
              </motion.div>
            ) : (
              friends.sort((a, b) => a.name.localeCompare(b.name)).map((friend) => {
                const visibleItems = getVisibleItemsForFriend(friend);
                return (
                  <motion.div
                    layout
                    key={friend.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-[32px] border border-neutral-200 shadow-sm overflow-hidden"
                    id={`friend-card-${friend.id}`}
                  >
                    <div className="p-5 border-b border-neutral-50 flex items-center justify-between bg-neutral-50/10">
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center text-neutral-400">
                            <Users size={18} />
                         </div>
                        <div>
                          <h3 className="font-black text-xl text-neutral-800 tracking-tight leading-none">{friend.name}</h3>
                          <p className="text-[10px] font-black text-amber-600 mt-2 uppercase tracking-tight">
                            TOTAL: {getFriendTotalCost(friend).toFixed(2)}€
                          </p>
                        </div>
                      </div>
                      <button 
                          onClick={() => removeFriend(friend.id)} 
                          className={`p-2.5 transition-all rounded-full shadow-sm border active:scale-90 flex items-center justify-center ${friendToDelete === friend.id ? 'bg-red-500 text-white border-red-500 scale-105' : 'text-neutral-200 bg-white border-neutral-100 hover:text-red-500'}`}
                          id={`delete-friend-${friend.id}`}
                      >
                        {friendToDelete === friend.id ? (
                          <span className="text-[10px] font-black uppercase px-2">Remover?</span>
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                    
                    <div className="p-4 space-y-2">
                      {visibleItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between bg-neutral-50/50 p-2.5 rounded-2xl border border-neutral-100" id={`counter-${friend.id}-${item.id}`}>
                          <div className="flex flex-col ml-1">
                            <span className="text-xs font-black text-neutral-700 tracking-tight">{item.label}</span>
                            <span className="text-[9px] font-bold text-neutral-400 tabular-nums">{item.price.toFixed(2)}€</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => updateCount(friend.id, item.id, -1)}
                              className="w-9 h-9 bg-white border border-neutral-200 rounded-full flex items-center justify-center text-neutral-500 shadow-sm active:scale-90"
                              id={`minus-${friend.id}-${item.id}`}
                            >
                              <Minus size={14} />
                            </button>
                            <span className="text-sm font-black min-w-[1.2rem] text-center tabular-nums text-neutral-900 leading-none">
                              {friend.counts[item.id] || 0}
                            </span>
                            <button
                              onClick={() => updateCount(friend.id, item.id, 1)}
                              disabled={item.price <= 0}
                              className={`w-9 h-9 border rounded-full flex items-center justify-center transition-all ${item.price <= 0 ? 'bg-neutral-100 border-neutral-100 text-neutral-300 cursor-not-allowed shadow-none' : 'bg-neutral-900 border-neutral-900 text-white shadow-md active:scale-95'}`}
                              id={`plus-${friend.id}-${item.id}`}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      
                      {/* Show button for secondary items if available but not used */}
                      {menu.length > visibleItems.length && (
                        <div className="pt-2 flex flex-wrap gap-1">
                          {menu.filter(m => !visibleItems.some(vi => vi.id === m.id)).map(hiddenItem => (
                            <button
                              key={hiddenItem.id}
                              onClick={() => updateCount(friend.id, hiddenItem.id, 1)}
                              disabled={hiddenItem.price <= 0}
                              className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full transition-colors ${hiddenItem.price <= 0 ? 'bg-neutral-100/50 text-neutral-300 cursor-not-allowed italic' : 'text-neutral-400 bg-neutral-100 hover:bg-neutral-200 hover:text-neutral-600'}`}
                            >
                              + {hiddenItem.label} {hiddenItem.price <= 0 && '(Sem Preço)'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer Summary (Compact & Expandable) */}
      {friends.length > 0 && (
        <motion.footer 
          initial={{ y: 100 }} animate={{ y: 0 }}
          className={`fixed bottom-4 left-4 right-4 bg-neutral-900 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50 transition-all duration-300 ease-out overflow-hidden ${isFooterExpanded ? 'rounded-[32px] p-6' : 'rounded-full p-4 h-16'}`}
          id="summary-footer"
        >
          <div className="max-w-md mx-auto h-full flex flex-col cursor-pointer" onClick={() => setIsFooterExpanded(!isFooterExpanded)}>
            {/* Expanded Content */}
            <AnimatePresence>
              {isFooterExpanded && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="mb-6 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <span className="text-[10px] font-black uppercase text-neutral-500 tracking-[0.2em]">{friends.length} AMIGOS NA MESA</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFooterExpanded(false);
                      }}
                      className="text-neutral-400 hover:text-white transition-colors p-1"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    {menu.filter(m => itemTotals[m.id] > 0).sort((a,b) => a.label.localeCompare(b.label)).map(item => (
                      <div key={item.id} className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-xl">
                        <span className="text-[11px] font-bold text-neutral-300 truncate">{item.label}</span>
                        <span className="text-sm font-black tabular-nums text-amber-500">{itemTotals[item.id]}</span>
                      </div>
                    ))}
                    {menu.filter(m => itemTotals[m.id] > 0).length === 0 && (
                      <p className="col-span-2 text-center text-[10px] text-neutral-600 font-bold uppercase italic py-2">Sem consumo registado</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Always Visible Row (Grand Total) */}
            <div className={`flex items-center justify-between w-full mt-auto ${!isFooterExpanded ? 'h-full' : 'pt-4 border-t border-white/10'}`}>
              <div className="flex flex-col justify-center">
                <span className={`text-[9px] font-black uppercase text-amber-500 tracking-[0.2em] ${!isFooterExpanded ? 'hidden xs:block text-neutral-500' : 'block'}`}>TOTAL DA MESA</span>
                <div className="flex items-baseline gap-1">
                  <span className={`${isFooterExpanded ? 'text-4xl' : 'text-2xl'} font-black tracking-tighter tabular-nums leading-none transition-all`}>
                    {grandTotal.toFixed(2)}
                  </span>
                  <span className="text-base font-bold text-neutral-500 italic">€</span>
                </div>
              </div>
              
              <div className={`flex items-center gap-2 ${!isFooterExpanded ? '' : 'flex-col items-end'}`}>
                {!isFooterExpanded && (
                  <div className="flex items-center gap-2 mr-2">
                     <span className="text-[10px] font-black text-neutral-500 bg-white/5 px-3 py-1 rounded-full uppercase tracking-tighter">
                       {friends.length} Amigos
                     </span>
                  </div>
                )}
                <div className={`w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white transition-transform duration-300 ${isFooterExpanded ? 'rotate-180' : ''}`}>
                  <ChevronUp size={20} />
                </div>
              </div>
            </div>
          </div>
        </motion.footer>
      )}
    </div>
  );
}
