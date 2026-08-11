{{- define "cicd-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cicd-platform.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "cicd-platform.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cicd-platform.labels" -}}
app.kubernetes.io/name: {{ include "cicd-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "cicd-platform.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "cicd-platform.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
