# Vendored faces

The two families the shipped templates draw with, committed rather than fetched.

`font add <family>` pulls from the Google Fonts repository through the GitHub API,
which for an unauthenticated caller is sixty requests an hour shared across the whole
host. That is fine for a person installing a face once. It is not fine inside a Docker
build: every deployment re-downloads the same files, and when the quota is gone — which
it will be, because CI and every other build on the machine draw from the same
allowance — the image fails to build for a reason that has nothing to do with the change
being deployed.

Committing them also makes the build reproducible, which is the same argument the
Dockerfile already makes for baking them in at all: a container that fetches its faces
is a container that renders differently the day the upstream repository moves a file.

| file | family | licence | source |
|---|---|---|---|
| `Anton-Regular.ttf` | Anton | OFL 1.1 | `google/fonts` `ofl/anton` |
| `ArchivoBlack-Regular.ttf` | Archivo Black | OFL 1.1 | `google/fonts` `ofl/archivoblack` |

`OFL.txt` is the licence both are issued under, and the SIL Open Font License requires it
travel with them. Redistribution is explicitly permitted; renaming is not, which is why
the family names above are the originals.

Anything else still comes in through `creative font add`, with its licence recorded.
This directory is not a font library — it is the two faces the templates in this
repository will not render without.
