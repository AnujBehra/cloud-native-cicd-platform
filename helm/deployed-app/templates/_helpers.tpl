{{- define "deployed-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "deployed-app.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "deployed-app.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "deployed-app.labels" -}}
app.kubernetes.io/name: {{ include "deployed-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
