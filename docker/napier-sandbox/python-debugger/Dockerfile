# Supply an immutable Napier base image ID/digest; this does not change the default image.
ARG NAPIER_SANDBOX_IMAGE
FROM ${NAPIER_SANDBOX_IMAGE}

COPY debugpy-1.8.17-py2.py3-none-any.whl /tmp/napier-debugpy.whl
RUN python3 -I -B -c "import hashlib,sysconfig,zipfile; p='/tmp/napier-debugpy.whl'; assert hashlib.sha256(open(p,'rb').read()).hexdigest() == '60c7dca6571efe660ccb7a9508d73ca14b8796c4ed484c2002abba714226cfef'; zipfile.ZipFile(p).extractall(sysconfig.get_path('purelib'))" \
  && rm /tmp/napier-debugpy.whl \
  && python3 -I -B -c "import debugpy; assert debugpy.__version__ == '1.8.17'"

LABEL org.opencontainers.image.description="Napier sandbox with pinned Python debugpy DAP runtime"
