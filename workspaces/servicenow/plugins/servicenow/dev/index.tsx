/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createDevApp } from '@backstage/dev-utils';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { Header, Page, TabbedLayout } from '@backstage/core-components';
import {
  mockComponentEntity,
  mockGuestUserEntity,
} from '../src/__fixtures__/mockEntity';

import { servicenowPlugin, EntityServicenowContent } from '../src/plugin';
import { servicenowTranslations } from '../src/translations';

createDevApp()
  .registerPlugin(servicenowPlugin)
  .addTranslationResource(servicenowTranslations)
  .setAvailableLanguages(['en', 'de', 'fr', 'it', 'es', 'ja'])
  .registerApi(
    catalogApiMock.factory({
      entities: [mockComponentEntity, mockGuestUserEntity],
    }),
  )
  .addPage({
    element: (
      <EntityProvider entity={mockComponentEntity}>
        <Page themeId="tool">
          <Header
            type="component — tool"
            title={mockComponentEntity.metadata.name}
          />
          <TabbedLayout>
            <TabbedLayout.Route path="/" title="ServiceNow">
              <EntityServicenowContent />
            </TabbedLayout.Route>
          </TabbedLayout>
        </Page>
      </EntityProvider>
    ),
    title: 'ServiceNow',
    path: '/servicenow',
  })
  .addPage({
    element: (
      <EntityProvider entity={mockGuestUserEntity}>
        <Page themeId="tool">
          <Header type="user" title={mockGuestUserEntity.metadata.name} />
          <TabbedLayout>
            <TabbedLayout.Route path="/" title="ServiceNow">
              <EntityServicenowContent />
            </TabbedLayout.Route>
          </TabbedLayout>
        </Page>
      </EntityProvider>
    ),
    title: 'My tickets',
    path: '/servicenow-user',
  })
  .render();
