import React from 'react';
import { createApp } from '@backstage/frontend-defaults';
import {
  createFrontendModule,
  createFrontendPlugin,
  PageBlueprint,
  createExtension,
  createExtensionDataRef,
} from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { SignInPage } from '@backstage/core-components';
import {
  AnyApiFactory,
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
  githubAuthApiRef,
} from '@backstage/core-plugin-api';
import {
  playlistApiRef,
  PlaylistClient,
} from '@backstage-community/plugin-playlist';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import rbacPlugin, {
  rbacTranslationsModule,
} from '@backstage-community/plugin-rbac/alpha';
import { navModule } from './modules/nav';

const signInPageModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    SignInPageBlueprint.makeWithOverrides({
      factory(originalFactory) {
        return originalFactory({
          loader: async () => props => (
            <SignInPage
              {...props}
              providers={[
                'guest',
                {
                  id: 'github-auth-provider',
                  title: 'GitHub',
                  message: 'Sign in using GitHub',
                  apiRef: githubAuthApiRef,
                },
              ]}
            />
          ),
        });
      },
    }),
  ],
});

const apiFactoryDataRef = createExtensionDataRef<AnyApiFactory>().with({
  id: 'core.api.factory',
});

const playlistApiExtension = createExtension({
  kind: 'api',
  name: 'playlist-api',
  attachTo: { id: 'root', input: 'apis' },
  output: [apiFactoryDataRef],
  *factory() {
    yield apiFactoryDataRef(
      createApiFactory({
        api: playlistApiRef,
        deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
        factory: ({ discoveryApi, fetchApi }) =>
          new PlaylistClient({ discoveryApi, fetchApi }),
      }),
    );
  },
});

const playlistPlugin = createFrontendPlugin({
  pluginId: 'playlist',
  extensions: [
    playlistApiExtension,
    PageBlueprint.make({
      params: {
        path: '/playlist',
        title: 'Playlists',
        loader: async () => {
          const { useApi } = await import('@backstage/core-plugin-api');
          const { useState, useEffect, useCallback } = await import('react');
          const { Button, Card, CardContent, Typography, CardActions, Chip, Box } = await import('@material-ui/core');

          const PlaylistPage = () => {
            const fetchApi = useApi(fetchApiRef);
            const discovery = useApi(discoveryApiRef);
            const [playlists, setPlaylists] = useState<any[]>([]);
            const [error, setError] = useState('');

            const loadPlaylists = useCallback(async () => {
              try {
                const baseUrl = await discovery.getBaseUrl('playlist');
                const resp = await fetchApi.fetch(baseUrl);
                if (resp.ok) setPlaylists(await resp.json());
                else setError(`Error: ${resp.status}`);
              } catch (e: any) { setError(e.message); }
            }, [fetchApi, discovery]);

            useEffect(() => { loadPlaylists(); }, [loadPlaylists]);

            const onCreate = async () => {
              const name = prompt('Playlist name:');
              if (!name) return;
              const isPublic = confirm('Make it public?');
              const owner = prompt('Owner (e.g. group:default/team-a):', 'group:default/team-a');
              const baseUrl = await discovery.getBaseUrl('playlist');
              const resp = await fetchApi.fetch(baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: name, public: isPublic, owner: owner || 'group:default/team-a' }),
              });
              if (resp.ok) loadPlaylists();
              else alert(`Error: ${resp.status} ${await resp.text()}`);
            };

            const onFollow = async (id: string) => {
              const baseUrl = await discovery.getBaseUrl('playlist');
              const resp = await fetchApi.fetch(`${baseUrl}/${id}/followers`, { method: 'POST' });
              if (resp.ok) { alert('Followed!'); loadPlaylists(); }
              else alert(`Follow error: ${resp.status} ${await resp.text()}`);
            };

            const onUpdate = async (id: string, current: any) => {
              const newName = prompt('New name:', current.name);
              if (!newName) return;
              const newDesc = prompt('New description:', current.description);
              const baseUrl = await discovery.getBaseUrl('playlist');
              const resp = await fetchApi.fetch(`${baseUrl}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, description: newDesc || current.description, public: current.public, owner: current.owner }),
              });
              if (resp.ok) loadPlaylists();
              else alert(`Update error: ${resp.status} ${await resp.text()}`);
            };

            const onDelete = async (id: string) => {
              if (!confirm('Delete this playlist?')) return;
              const baseUrl = await discovery.getBaseUrl('playlist');
              const resp = await fetchApi.fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
              if (resp.ok) loadPlaylists();
              else alert(`Delete error: ${resp.status} ${await resp.text()}`);
            };

            if (error) return <Typography color="error">{error}</Typography>;

            return (
              <Box>
                <Button variant="contained" color="primary" onClick={onCreate} style={{marginBottom: 16}}>
                  Create Playlist
                </Button>
                {playlists.length === 0 && <Typography>No playlists found.</Typography>}
                {playlists.map((p: any) => (
                  <Card key={p.id} style={{marginBottom: 8}}>
                    <CardContent>
                      <Typography variant="h6">{p.name}</Typography>
                      <Typography color="textSecondary">{p.description}</Typography>
                      <Box mt={1}>
                        <Chip label={p.public ? 'Public' : 'Private'} size="small" style={{marginRight: 4}} />
                        <Chip label={`Owner: ${p.owner}`} size="small" style={{marginRight: 4}} />
                        <Chip label={`Followers: ${p.followers || 0}`} size="small" />
                      </Box>
                    </CardContent>
                    <CardActions>
                      <Button size="small" color="primary" onClick={() => onFollow(p.id)}>Follow</Button>
                      <Button size="small" onClick={() => onUpdate(p.id, p)}>Edit</Button>
                      <Button size="small" color="secondary" onClick={() => onDelete(p.id)}>Delete</Button>
                    </CardActions>
                  </Card>
                ))}
              </Box>
            );
          };

          return <PlaylistPage />;
        },
      },
    }),
  ],
});

export default createApp({
  features: [
    catalogPlugin,
    rbacPlugin,
    rbacTranslationsModule,
    playlistPlugin,
    navModule,
    signInPageModule,
  ],
});
