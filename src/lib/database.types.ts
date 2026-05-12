export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          event_date: string
          event_time: string | null
          id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date: string
          event_time?: string | null
          id?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date?: string
          event_time?: string | null
          id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      card_assignees: {
        Row: {
          assigned_by: string | null
          card_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          card_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          card_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
        ]
      }
      card_comments: {
        Row: {
          author_id: string
          body: string
          card_id: string
          created_at: string
          id: string
          mentioned_user_ids: string[]
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          card_id: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          card_id?: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_comments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_subtasks: {
        Row: {
          card_id: string
          created_at: string
          created_by: string | null
          done: boolean
          id: string
          label: string
          position: number
          updated_at: string
        }
        Insert: {
          card_id: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          label: string
          position?: number
          updated_at?: string
        }
        Update: {
          card_id?: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          label?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_subtasks_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_subtasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      graph_layouts: {
        Row: {
          label_name: string
          project_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
          x: number
          y: number
        }
        Insert: {
          label_name: string
          project_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
          x: number
          y: number
        }
        Update: {
          label_name?: string
          project_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "graph_layouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "script_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graph_layouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graph_layouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string
          card_id: string | null
          comment_id: string | null
          created_at: string
          id: string
          kind: string
          read: boolean
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          actor_id?: string | null
          body: string
          card_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind: string
          read?: boolean
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          actor_id?: string | null
          body?: string
          card_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          read?: boolean
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "card_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
      script_characters: {
        Row: {
          age: string | null
          aliases: string[]
          avatar_url: string | null
          color: string
          created_at: string
          created_by: string | null
          emoji: string | null
          id: string
          name: string
          position: number
          project_id: string
          pronouns: string | null
          role: string | null
          rpy_var: string | null
          short_name: string | null
          traits: Json
          updated_at: string
          voice_notes: string
          workspace_id: string
        }
        Insert: {
          age?: string | null
          aliases?: string[]
          avatar_url?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          name: string
          position?: number
          project_id: string
          pronouns?: string | null
          role?: string | null
          rpy_var?: string | null
          short_name?: string | null
          traits?: Json
          updated_at?: string
          voice_notes?: string
          workspace_id: string
        }
        Update: {
          age?: string | null
          aliases?: string[]
          avatar_url?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
          pronouns?: string | null
          role?: string | null
          rpy_var?: string | null
          short_name?: string | null
          traits?: Json
          updated_at?: string
          voice_notes?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_characters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "script_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_characters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      script_locations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          image_url: string | null
          mood: string | null
          name: string
          position: number
          project_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          image_url?: string | null
          mood?: string | null
          name: string
          position?: number
          project_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          image_url?: string | null
          mood?: string | null
          name?: string
          position?: number
          project_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "script_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      script_nodes: {
        Row: {
          body: string
          content: Json | null
          created_at: string
          created_by: string | null
          emoji: string | null
          id: string
          kind: Database["public"]["Enums"]["script_node_kind"]
          location_id: string | null
          parent_id: string | null
          pinned: boolean
          position: number
          pov: string | null
          project_id: string
          rpy_blocks: Json | null
          rpy_label: string | null
          source_kind: string
          status: string
          tags: string[]
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          body?: string
          content?: Json | null
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["script_node_kind"]
          location_id?: string | null
          parent_id?: string | null
          pinned?: boolean
          position?: number
          pov?: string | null
          project_id: string
          rpy_blocks?: Json | null
          rpy_label?: string | null
          source_kind?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          content?: Json | null
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["script_node_kind"]
          location_id?: string | null
          parent_id?: string | null
          pinned?: boolean
          position?: number
          pov?: string | null
          project_id?: string
          rpy_blocks?: Json | null
          rpy_label?: string | null
          source_kind?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_nodes_location_fk"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "script_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "script_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "script_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_nodes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_nodes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      script_projects: {
        Row: {
          cover_emoji: string | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          id: string
          position: number
          synopsis: string
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          cover_emoji?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          position?: number
          synopsis?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          cover_emoji?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          position?: number
          synopsis?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_projects_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
      translation_files: {
        Row: {
          filename: string
          folder_path: string
          id: string
          project_id: string
          raw_content: string
          target_language: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          filename: string
          folder_path?: string
          id?: string
          project_id: string
          raw_content: string
          target_language: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          filename?: string
          folder_path?: string
          id?: string
          project_id?: string
          raw_content?: string
          target_language?: string
          uploaded_at?: string
          uploaded_by?: string | null
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
      translation_projects: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          source_lang: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          source_lang?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          source_lang?: string
          workspace_id?: string
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
      translation_strings: {
        Row: {
          file_id: string
          group_label: string | null
          id: string
          source_line: number
          source_path: string
          source_text: string
          speaker: string | null
          status: string
          trailing: string | null
          translate_id: string | null
          translated_text: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          file_id: string
          group_label?: string | null
          id?: string
          source_line: number
          source_path: string
          source_text: string
          speaker?: string | null
          status?: string
          trailing?: string | null
          translate_id?: string | null
          translated_text?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          file_id?: string
          group_label?: string | null
          id?: string
          source_line?: number
          source_path?: string
          source_text?: string
          speaker?: string | null
          status?: string
          trailing?: string | null
          translate_id?: string | null
          translated_text?: string
          updated_at?: string
          updated_by?: string | null
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
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_invited_user_id_fkey"
            columns: ["invited_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
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
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { _invitation_id: string }
        Returns: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          target_language: string | null
          user_id: string
          workspace_id: string
        }
      }
      create_workspace: {
        Args: { _name: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
        }
      }
      invite_to_workspace: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["workspace_role"]
          _workspace_id: string
        }
        Returns: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          invited_user_id: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          target_language: string | null
          workspace_id: string
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
      script_role_in: { Args: { _ws: string }; Returns: string }
      translation_file_stats: {
        Args: { _file_ids: string[] }
        Returns: {
          done: number
          file_id: string
          total: number
        }[]
      }
      translation_role_in: { Args: { workspace_uuid: string }; Returns: string }
    }
    Enums: {
      card_priority: "low" | "medium" | "high" | "urgent"
      script_node_kind: "chapter" | "scene" | "block"
      workspace_role: "owner" | "editor" | "viewer" | "translator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      card_priority: ["low", "medium", "high", "urgent"],
      script_node_kind: ["chapter", "scene", "block"],
      workspace_role: ["owner", "editor", "viewer", "translator"],
    },
  },
} as const
