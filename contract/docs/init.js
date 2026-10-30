const servedFromHere = () => ({
	statePlugins: {
		spec: {
			wrapActions: {
				updateJsonSpec: (original) => (spec) =>
					original({
						...spec,
						servers: [{ url: `${window.location.origin}/api` }],
					}),
			},
		},
	},
});

SwaggerUIBundle({
	url: "/api/openapi.yaml",
	dom_id: "#swagger-ui",
	deepLinking: true,
	validatorUrl: null,
	plugins: [servedFromHere],
});
