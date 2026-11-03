import { create } from "zustand";
import { Relationship, RelationshipType } from "../types";
import { api, ApiError } from "../api/client";

export interface RelationshipState {
  relationships: Relationship[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchRelationships: () => Promise<Relationship[]>;
  sendFriendRequest: (username: string) => Promise<Relationship>;
  acceptRequest: (targetId: string) => Promise<Relationship>;
  removeRelationship: (targetId: string) => Promise<void>;
  blockUser: (targetId: string) => Promise<Relationship>;

  // Gateway event reducers
  handleRelationshipAdd: (rel: Relationship) => void;
  handleRelationshipRemove: (payload: { id: string }) => void;
  handleRelationshipUpdate: (rel: Relationship) => void;
}

export const useRelationshipStore = create<RelationshipState>((set, get) => ({
  relationships: [],
  isLoading: false,
  error: null,

  fetchRelationships: async () => {
    set({ isLoading: true, error: null });
    try {
      const rels = await api.relationships.list();
      set({ relationships: rels || [], isLoading: false });
      return rels || [];
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Falha ao carregar lista de amigos";
      set({ isLoading: false, error: msg });
      return [];
    }
  },

  sendFriendRequest: async (username: string) => {
    set({ error: null });
    try {
      const rel = await api.relationships.sendRequest(username);
      set((state) => {
        const filtered = state.relationships.filter((r) => r.id !== rel.id);
        return { relationships: [...filtered, rel] };
      });
      return rel;
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Falha ao enviar pedido de amizade";
      set({ error: msg });
      throw err;
    }
  },

  acceptRequest: async (targetId: string) => {
    try {
      const rel = await api.relationships.accept(targetId);
      set((state) => {
        const filtered = state.relationships.filter((r) => r.id !== targetId);
        return { relationships: [...filtered, rel] };
      });
      return rel;
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Falha ao aceitar pedido";
      set({ error: msg });
      throw err;
    }
  },

  removeRelationship: async (targetId: string) => {
    try {
      await api.relationships.remove(targetId);
      set((state) => ({
        relationships: state.relationships.filter((r) => r.id !== targetId),
      }));
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Falha ao remover relação";
      set({ error: msg });
      throw err;
    }
  },

  blockUser: async (targetId: string) => {
    try {
      const rel = await api.relationships.block(targetId);
      set((state) => {
        const filtered = state.relationships.filter((r) => r.id !== targetId);
        return { relationships: [...filtered, rel] };
      });
      return rel;
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Falha ao bloquear usuário";
      set({ error: msg });
      throw err;
    }
  },

  handleRelationshipAdd: (rel: Relationship) => {
    set((state) => {
      const filtered = state.relationships.filter((r) => r.id !== rel.id);
      return { relationships: [...filtered, rel] };
    });
  },

  handleRelationshipRemove: (payload: { id: string }) => {
    set((state) => ({
      relationships: state.relationships.filter((r) => r.id !== payload.id),
    }));
  },

  handleRelationshipUpdate: (rel: Relationship) => {
    set((state) => {
      const next = state.relationships.map((r) => (r.id === rel.id ? rel : r));
      return { relationships: next };
    });
  },
}));
