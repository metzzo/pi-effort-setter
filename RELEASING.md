# Releasing

1. Confirm the working tree is clean and the intended commit is checked out.
2. Confirm the package name is still available or owned by the publisher:

   ```bash
   npm view pi-model-thinking-levels
   ```

3. Update the version and `CHANGELOG.md` together.
4. Install exactly the locked development dependencies and run the deterministic release gate:

   ```bash
   npm ci
   npm run release:check
   ```

5. Run the real Pi integration suite in an authenticated development environment:

   ```bash
   npm run test:integration
   ```

6. Inspect the exact tarball contents and perform an npm dry run:

   ```bash
   npm pack --dry-run
   npm publish --dry-run
   ```

7. Publish and verify installation through Pi:

   ```bash
   npm publish
   pi install npm:pi-model-thinking-levels@<version>
   ```

8. Tag the release commit with `v<version>` and publish the matching source-host release notes.

Never publish from a dirty working tree or include local Pi credentials, state, or test artifacts.
