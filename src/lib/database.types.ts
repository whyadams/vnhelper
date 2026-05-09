export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      boards: {
        Row: {
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          id: string
          workspace_id: string
          title: string
          event_date: string
          event_time: string | null
          color: string
          description: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          title: string
          event_date: string
          event_time?: string | null
          color?: string
          description?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string
          event_date?: string
          event_time?: string | null
          color?: string
          description?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      card_assignees: {
        Row: {
          card_id: string
          user_id: string
          assigned_by: string | null
          created_at: string
        }
        Insert: {
          card_id: string
          user_id: string
          assigned_by?: string | null
          created_at?: string
        }
        Update: {
          card_id?: string
          user_id?: string
          assigned_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_assignees_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      card_comments: {
        Row: {
          id: string
          card_id: string
          author_id: string
          body: string
          mentioned_user_ids: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          card_id: string
          author_id: string
          body: string
          mentioned_user_ids?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          card_id?: string
          author_id?: string
          body?: string
          mentioned_user_ids?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          actor_id: string | null
          workspace_id: string | null
          card_id: string | null
          comment_id: string | null
          body: string
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          actor_id?: string | null
          workspace_id?: string | null
          card_id?: string | null
          comment_id?: string | null
          body: string
          read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          actor_id?: string | null
          workspace_id?: string | null
          card_id?: string | null
          comment_id?: string | null
          body?: string
          read?: boolean
          created_at?: string
        }
        Relationships: []
      }
      card_subtasks: {
        Row: {
          id: string
          card_id: string
          label: string
          done: boolean
          position: number
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          card_id: string
          label: string
          done?: boolean
          position?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          card_id?: string
          label?: string
          done?: boolean
          position?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      card_tags: {
        Row: {
          card_id: string
          tag_id: string
        }
        Insert: {
          card_id: string
          tag_id: string
        }
        Update: {
          card_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_tags_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          board_id: string
          brand: string | null
          brand_fallback: string | null
          column_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          meta: Json
          position: number
          priority: Database["public"]["Enums"]["card_priority"] | null
          subtitle: string
          title: string
          updated_at: string
        }
        Insert: {
          board_id: string
          brand?: string | null
          brand_fallback?: string | null
          column_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          position?: number
          priority?: Database["public"]["Enums"]["card_priority"] | null
          subtitle?: string
          title: string
          updated_at?: string
        }
        Update: {
          board_id?: string
          brand?: string | null
          brand_fallback?: string | null
          column_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meta?: Json
          position?: number
          priority?: Database["public"]["Enums"]["card_priority"] | null
          subtitle?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      columns: {
        Row: {
          board_id: string
          created_at: string
          id: string
          key: string
          position: number
          title: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          key: string
          position?: number
          title: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          key?: string
          position?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      script_projects: {
        Row: {
          id: string
          workspace_id: string
          title: string
          synopsis: string
          cover_emoji: string | null
          cover_image_url: string | null
          position: number
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          title?: string
          synopsis?: string
          cover_emoji?: string | null
          cover_image_url?: string | null
          position?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string
          synopsis?: string
          cover_emoji?: string | null
          cover_image_url?: string | null
          position?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      script_nodes: {
        Row: {
          id: string
          project_id: string
          workspace_id: string
          parent_id: string | null
          kind: "chapter" | "scene" | "block"
          title: string
          emoji: string | null
          body: string
          content: Json | null
          tags: string[]
          status: string
          pov: string | null
          location_id: string | null
          pinned: boolean
          position: number
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id: string
          parent_id?: string | null
          kind?: "chapter" | "scene" | "block"
          title?: string
          emoji?: string | null
          body?: string
          content?: Json | null
          tags?: string[]
          status?: string
          pov?: string | null
          location_id?: string | null
          pinned?: boolean
          position?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string
          parent_id?: string | null
          kind?: "chapter" | "scene" | "block"
          title?: string
          emoji?: string | null
          body?: string
          content?: Json | null
          tags?: string[]
          status?: string
          pov?: string | null
          location_id?: string | null
          pinned?: boolean
          position?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      script_characters: {
        Row: {
          id: string
          project_id: string
          workspace_id: string
          name: string
          short_name: string | null
          color: string
          emoji: string | null
          pronouns: string | null
          age: string | null
          role: string | null
          voice_notes: string
          traits: Json
          aliases: string[]
          avatar_url: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id: string
          name: string
          short_name?: string | null
          color?: string
          emoji?: string | null
          pronouns?: string | null
          age?: string | null
          role?: string | null
          voice_notes?: string
          traits?: Json
          aliases?: string[]
          avatar_url?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string
          name?: string
          short_name?: string | null
          color?: string
          emoji?: string | null
          pronouns?: string | null
          age?: string | null
          role?: string | null
          voice_notes?: string
          traits?: Json
          aliases?: string[]
          avatar_url?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      script_locations: {
        Row: {
          id: string
          project_id: string
          workspace_id: string
          name: string
          description: string
          mood: string | null
          image_url: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id: string
          name: string
          description?: string
          mood?: string | null
          image_url?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string
          name?: string
          description?: string
          mood?: string | null
          image_url?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      graph_nodes: {
        Row: {
          id: string
          project_id: string
          workspace_id: string
          kind: "scene" | "choice" | "ending" | "chapter" | "note"
          title: string
          subtitle: string
          ending_kind: string | null
          linked_scene_id: string | null
          x: number
          y: number
          width: number | null
          height: number | null
          meta: Json
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id: string
          kind: "scene" | "choice" | "ending" | "chapter" | "note"
          title?: string
          subtitle?: string
          ending_kind?: string | null
          linked_scene_id?: string | null
          x?: number
          y?: number
          width?: number | null
          height?: number | null
          meta?: Json
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string
          kind?: "scene" | "choice" | "ending" | "chapter" | "note"
          title?: string
          subtitle?: string
          ending_kind?: string | null
          linked_scene_id?: string | null
          x?: number
          y?: number
          width?: number | null
          height?: number | null
          meta?: Json
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      graph_edges: {
        Row: {
          id: string
          project_id: string
          workspace_id: string
          from_node_id: string
          to_node_id: string
          label: string
          meta: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id: string
          from_node_id: string
          to_node_id: string
          label?: string
          meta?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string
          from_node_id?: string
          to_node_id?: string
          label?: string
          meta?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      graph_boards: {
        Row: {
          project_id: string
          workspace_id: string
          data: Json
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          project_id: string
          workspace_id: string
          data?: Json
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          project_id?: string
          workspace_id?: string
          data?: Json
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          board_id: string
          color: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_projects: {
        Row: {
          id: string
          workspace_id: string
          name: string
          source_lang: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          source_lang?: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          source_lang?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "translation_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_files: {
        Row: {
          id: string
          project_id: string
          filename: string
          raw_content: string
          target_language: string
          uploaded_at: string
          uploaded_by: string | null
          folder_path: string
        }
        Insert: {
          id?: string
          project_id: string
          filename: string
          raw_content: string
          target_language: string
          uploaded_at?: string
          uploaded_by?: string | null
          folder_path?: string
        }
        Update: {
          id?: string
          project_id?: string
          filename?: string
          raw_content?: string
          target_language?: string
          uploaded_at?: string
          uploaded_by?: string | null
          folder_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "translation_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_strings: {
        Row: {
          id: string
          file_id: string
          group_label: string | null
          source_path: string
          source_line: number
          source_text: string
          translated_text: string
          status: string
          updated_at: string
          updated_by: string | null
          translate_id: string | null
          speaker: string | null
          trailing: string | null
        }
        Insert: {
          id?: string
          file_id: string
          group_label?: string | null
          source_path: string
          source_line: number
          source_text: string
          translated_text?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          translate_id?: string | null
          speaker?: string | null
          trailing?: string | null
        }
        Update: {
          id?: string
          file_id?: string
          group_label?: string | null
          source_path?: string
          source_line?: number
          source_text?: string
          translated_text?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          translate_id?: string | null
          speaker?: string | null
          trailing?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "translation_strings_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "translation_files"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          invited_user_id: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          target_language: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          invited_user_id?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          target_language?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          invited_user_id?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          target_language?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          target_language: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          target_language?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          target_language?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          avatar_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          avatar_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          avatar_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      translation_file_stats: {
        Args: { _file_ids: string[] }
        Returns: {
          file_id: string
          total: number
          done: number
        }[]
      }
      create_workspace: {
        Args: { _name: string }
        Returns: {
          id: string
          name: string
          owner_id: string
          created_at: string
        }
      }
      invite_to_workspace: {
        Args: {
          _workspace_id: string
          _email: string
          _role?: Database["public"]["Enums"]["workspace_role"]
        }
        Returns: {
          id: string
          workspace_id: string
          email: string
          invited_user_id: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          invited_by: string | null
          created_at: string
        }
      }
      accept_invitation: {
        Args: { _invitation_id: string }
        Returns: {
          workspace_id: string
          user_id: string
          role: Database["public"]["Enums"]["workspace_role"]
          created_at: string
        }
      }
      reject_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      revoke_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
    }
    Enums: {
      workspace_role: "owner" | "editor" | "viewer" | "translator"
      card_priority: "low" | "medium" | "high" | "urgent"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
