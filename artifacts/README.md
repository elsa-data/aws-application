A set of artifacts that are built/deployed by CDK.

These live in a separate top-level directory to the actual stack
as we don't want them to accidentally inherit any parent context from the
stack (like tsconfig.json).

These artifacts might be in different languages entirely to the rest of the
CDK. They should be self-contained within their own folders (i.e. contain all the pipenv/tsconfig etc
that they would need to build).
