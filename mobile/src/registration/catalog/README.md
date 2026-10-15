# Vehicle catalog

Sources retrieved 7 October 2026:

- [GlobalCarModels](https://github.com/serhatkildaci/global-car-models), freshly downloaded `data/models.json`. MIT license: `LICENSE`.
- [Savage3D car-makes-models-data](https://github.com/Savage3D/car-makes-models-data), `car-makes.json`. MIT license: `Savage3D-LICENSE`.
- [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/), passenger-car makes and models filtered to passenger cars, trucks and multipurpose passenger vehicles. Motorcycles are excluded. Its [ownership statement](https://www.nhtsa.gov/about-nhtsa/terms-use) permits distribution and copying of public information.
- Atlas-maintained regional model names in atlas-models.json, including Japanese domestic-market models, and GAZ commercial models verified against the [official dealer catalog](https://www.avtogaz.ru/models/).

The independently rebuilt catalog contains 250 makes and 4,223 model names. It does not include the former VehiclesDB data. These sources require no attribution label in the selection interface; MIT notices are retained in the source and packaged Android assets. Selection is offline; aliases are reconciled and exact duplicate names are removed. Existing saved names remain valid even if absent from the catalog. This is not an exhaustive list of worldwide trims or model years.

Brand logos come from [Car Logos Dataset](https://github.com/filippofilip95/car-logos-dataset), originally sourced from Carlogos.org. The dataset README declares MIT licensing; trademarks belong to their respective owners. Only logos with a matched catalog brand are bundled, preserving their proportions. The optimized local files are at `assets/brands/`; unavailable logos use a neutral vehicle outline. No runtime request to the logo provider is made.
